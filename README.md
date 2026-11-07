# YT Reminder 📺

A small web app that helps you actually watch the YouTube channels you keep meaning to learn from
(for example [Hussein Nasser](https://www.youtube.com/@hnasr) for backend engineering).

- Sign in with just your email (passwordless link).
- Add one or more YouTube channels by pasting a link (`https://www.youtube.com/@hnasr`, `@hnasr`, `/channel/UC…`).
- Every day the app picks **one random video you haven't watched** from each channel and emails it to you.
  - Default times are **10:00** (today's video) and **20:00** (reminder for the same video). You can change both the times and your time zone, with up to 6 emails a day.
  - If you mark the video as watched before the evening email, the evening email suggests a new one.
  - Videos that have never been suggested are picked first, and Shorts (under `MIN_VIDEO_SECONDS`) are skipped.
- Each email has **"✓ I've already watched this"**. One click and the video is never suggested again.
- Each email reminds you to **write notes in Notion** and links your Notion page if you set one.
- A dashboard shows today's videos, progress per channel, recently watched videos (with undo), and settings.
- Optional **Connect YouTube**: videos you mark as watched are also added to a private
  "Watched ✓ (YT Reminder)" playlist on your YouTube account.

> **Why a playlist and not YouTube's own "watched" status?** YouTube's API doesn't let any app read or
> change your watch history, so there is no way to mark a video as watched on YouTube itself.
> For the same reason the app can't detect videos you watched directly on YouTube. Use the
> "already watched" button (in the email or on the dashboard) for those.

## Running locally

Requires Node.js 22.13+ (it uses the built-in `node:sqlite`, so there is no native database dependency).

```bash
npm install
cp .env.example .env     # then fill in the values below
npm start                # http://localhost:3000
npm test
```

Without `RESEND_API_KEY`, emails (including sign-in links) are printed to the terminal, which is handy for development.

### Configuration (`.env`)

| Variable | Required | Notes |
|---|---|---|
| `APP_URL` | yes | Public URL, used in email links. |
| `APP_SECRET` | yes | Long random string. Signs email links and sessions. |
| `RESEND_API_KEY` | yes (prod) | From [resend.com](https://resend.com). |
| `EMAIL_FROM` | yes (prod) | Address on a domain you **verified in Resend**. The default `onboarding@resend.dev` only delivers to your own Resend account address. |
| `YOUTUBE_API_KEY` | recommended | Google Cloud → enable *YouTube Data API v3* → create an API key. Without it, only a channel's latest 15 videos are available (via RSS). With it, the full back catalogue is imported. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | OAuth client (Web application) for "Connect YouTube". Redirect URI: `<APP_URL>/auth/google/callback`. Scope used: `youtube`. Until your Google app is verified, add users as *test users* on the OAuth consent screen. |
| `DEFAULT_TIMEZONE` | no | Default `Asia/Kolkata`. Each user can change theirs. |
| `DEFAULT_SEND_TIMES` | no | Default `10:00,20:00`. |
| `MIN_VIDEO_SECONDS` | no | Default `180`. Shorter videos (Shorts) are never picked. |
| `CRON_SECRET` / `DISABLE_SCHEDULER` | no | See *Scheduling* below. |
| `DATABASE_PATH` | no | SQLite file, default `./data/app.db`. |

## Scheduling

The server checks every minute which users have an email due in **their own time zone** and sends it.
Each send is recorded, so a user never gets the same slot twice, even with several instances running against the
same database. If the server was down at send time, the email still goes out if it comes back within 90 minutes.
New uploads are picked up automatically (channels are re-synced every 12 hours).

On hosts that put the app to sleep (or serverless), set `DISABLE_SCHEDULER=1` and `CRON_SECRET`, then have
an external cron hit `POST /cron` with `Authorization: Bearer <CRON_SECRET>` every few minutes.

## Deploying

Any host that runs a long-lived Node process with a persistent disk works (Railway, Render, Fly.io, a VPS):

```bash
docker build -t yt-reminder .
docker run -p 3000:3000 -v yt-data:/data --env-file .env yt-reminder
```

Make sure `/data` (the SQLite file) is on a persistent volume.

## Project layout

```
src/
  index.js          start server + scheduler
  server.js         routes (auth, dashboard, email links, Google OAuth, /cron)
  reminders.js      builds/sends daily emails, per-minute scheduler
  picker.js         random unwatched-video selection, mark watched
  youtube.js        channel link parsing, channel/video sync (Data API or RSS)
  google.js         optional YouTube OAuth + "Watched" playlist
  emailTemplates.js email HTML/text
  auth.js           passwordless email login + sessions
  db.js / time.js / tokens.js / html.js / views.js / email.js
test/               node:test suite
```
