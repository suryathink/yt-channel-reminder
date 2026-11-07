# YT Reminder 📺

Get a daily email with one YouTube video you haven't watched yet, from the channels you want to learn from
(for example [Hussein Nasser](https://www.youtube.com/@hnasr) for backend engineering).

- Sign in with just your email (passwordless link). Reminders go to that address.
- Add one or more channels by pasting a link (`https://www.youtube.com/@hnasr`, `@hnasr`, `/channel/UC…`).
- Every day it picks **one random video you haven't watched** from each channel:
  - default **10:00** = today's video, **20:00** = reminder for the same video (a new one if you already watched it)
  - send times (up to 6) and time zone are configurable per user
  - never-suggested videos first; Shorts are skipped
- Every email has **"✓ I've already watched this"**, so the video is never suggested again, plus a nudge to
  **write notes in Notion** (links your Notion page if you set one).
- Optional **Connect YouTube**: watched videos are added to a private "Watched ✓ (YT Reminder)" playlist on your account.

> YouTube's API does not allow any app to read or change watch history, so the app can't mark videos as watched
> *on YouTube itself* or see what you watched there. The private playlist is the closest thing YouTube allows.

## Tech stack

| Part | Tech |
|---|---|
| Frontend (`web/`) | Next.js 16 (App Router), React 19, TypeScript, SCSS (Sass modules + shared tokens/mixins) |
| Backend (`server/`) | Node.js + Express 5 JSON API, built-in per-minute scheduler |
| Database | MongoDB Atlas (official `mongodb` driver) |
| Email | Resend |
| YouTube | YouTube Data API v3 (API key), Google OAuth for the optional playlist |

The browser only talks to the Next.js app. Next.js proxies `/api/*` to the Express server (`web/next.config.ts`),
so the session cookie is first-party and there's no CORS to set up.

```
web/      Next.js frontend           server/   Express API + scheduler
  app/          pages                  src/server.js        API routes (/api/...)
  components/   UI + *.module.scss     src/reminders.js     emails + scheduler
  styles/       _variables, _mixins    src/picker.js        random unwatched video
  lib/          api client, types      src/youtube.js       channel + video sync
                                       src/db.js            MongoDB collections + indexes
```

## Setup

### 1. MongoDB Atlas (free)
1. Create a free **M0** cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access**: add a database user. **Network Access**: allow your server's IP (or `0.0.0.0/0`).
3. **Connect → Drivers**: copy the connection string into `MONGODB_URI`.
Indexes are created automatically on startup.

### 2. Keys
- **Resend**: API key, and verify a domain to send from (`onboarding@resend.dev` only delivers to your own Resend account email).
- **YouTube Data API v3 key** (Google Cloud console): strongly recommended. Without it only each channel's latest 15 videos are available.
- *Optional* Google OAuth client (Web application) for "Connect YouTube".
  Authorized redirect URI: `<WEB_URL>/api/auth/google/callback`.

### 3. Run locally
```bash
npm run install:all
cp server/.env.example server/.env   # fill in MONGODB_URI, APP_SECRET, RESEND_API_KEY, YOUTUBE_API_KEY…
cp web/.env.example web/.env.local   # BACKEND_URL=http://localhost:4000
npm run dev:server                   # API on :4000
npm run dev:web                      # site on http://localhost:3000
```
Without `RESEND_API_KEY`, emails (including sign-in links) are printed in the server terminal.

### 4. Tests
```bash
npm test
```
Database tests start a temporary in-memory MongoDB automatically (it downloads `mongod` on first run),
or use `MONGODB_TEST_URI=mongodb://...` to point them at a test database. Never point it at production;
the test database is dropped afterwards.

## Deploying

- **Backend (`server/`)**: any host that runs a long-lived Node process: Render, Railway, Fly.io, or a VPS
  (a `Dockerfile` is included). Set the variables from `server/.env.example`, with `WEB_URL` = your frontend URL.
  If the host sleeps when idle (e.g. Render free tier), set `DISABLE_SCHEDULER=1` and `CRON_SECRET`, and have a
  free cron service (cron-job.org, GitHub Actions) call `POST <backend>/api/cron` with
  `Authorization: Bearer <CRON_SECRET>` every 5 minutes.
- **Frontend (`web/`)**: Vercel (or any Next.js host). Set `BACKEND_URL` to the backend's URL **before building**
  (it's baked into the `/api` proxy at build time).

Emails are sent in each user's own time zone; each slot is recorded in MongoDB so nobody gets the same email twice,
even with several server instances. If the server was down at send time, the email still goes out if it comes back
within 90 minutes. New uploads are picked up every 12 hours.
