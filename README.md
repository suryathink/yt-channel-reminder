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
| Frontend (`client/`) | Next.js 16 (App Router), React 19, TypeScript, SCSS (Sass modules + shared tokens/mixins) |
| Backend (`server/`) | Node.js + Express 5 JSON API, built-in per-minute scheduler |
| Hosting | Docker Compose behind Nginx + Certbot (HTTPS) on a DigitalOcean droplet, deployed by GitHub Actions via Docker Hub |
| Database | MongoDB Atlas (official `mongodb` driver) |
| Email | Resend |
| YouTube | YouTube Data API v3 (API key), Google OAuth for the optional playlist |

Frontend and API are served from the same domain: in production Nginx sends `/api/*` to Express and everything else
to Next.js (in local dev, Next.js proxies `/api/*` itself via `client/next.config.ts`). So the session cookie is
first-party and there's no CORS to set up.

```
client/   Next.js frontend           server/   Express API + scheduler
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
cp client/.env.example client/.env.local   # BACKEND_URL=http://localhost:4000
npm run dev:server                   # API on :4000
npm run dev:client                   # site on http://localhost:3000
```
Without `RESEND_API_KEY`, emails (including sign-in links) are printed in the server terminal.

### 4. Tests
```bash
npm test
```
Database tests start a temporary in-memory MongoDB automatically (it downloads `mongod` on first run),
or use `MONGODB_TEST_URI=mongodb://...` to point them at a test database. Never point it at production;
the test database is dropped afterwards.

## Automatic deploys (GitHub Actions)

`.github/workflows/deploy.yml` runs on every push to `main`:

1. **test**: server tests (with a temporary MongoDB), client typecheck and build
2. **build**: builds both Docker images on GitHub and pushes them to Docker Hub
   (`<DOCKER_USERNAME>/yt-reminder-server` and `-client`, tagged with the commit)
3. **deploy**: SSHes into the droplet, copies the compose file and deploy scripts, writes `server/.env` from the
   secrets, pulls the new images and restarts. On the first deploy it also creates the Nginx site and gets the HTTPS
   certificate with Certbot (`deploy/remote-deploy.sh`).

Nothing is built or pushed until every required value below exists. You can also run it by hand from the
**Actions** tab ("Run workflow").

**Settings → Secrets and variables → Actions**

| Name | Type | Required | Where to get it |
|---|---|---|---|
| `DROPLET_HOST` | Secret | ✅ | Droplet's IP (DigitalOcean → Droplets) |
| `DROPLET_USER` | Secret | ✅ | SSH user, usually `root` |
| `DROPLET_SSH_KEY` | Secret | ✅ | Private key whose public key is in the droplet's `~/.ssh/authorized_keys` |
| `DROPLET_KNOWN_HOSTS` | Secret | recommended | Output of `ssh-keyscan <droplet-ip>`, run from your own computer |
| `DROPLET_SSH_PORT` | Secret | – | Only if SSH isn't on port 22 |
| `DOCKER_USERNAME` | Secret | ✅ | Docker Hub username |
| `DOCKER_PASSWORD` | Secret | ✅ | Docker Hub → Account settings → Personal access tokens (Read & Write) |
| `MONGODB_URI` | Secret | ✅ | Atlas → your cluster → Connect → Drivers |
| `RESEND_API_KEY` | Secret | ✅ | resend.com → API Keys |
| `YOUTUBE_API_KEY` | Secret | ✅ | Google Cloud console → enable *YouTube Data API v3* → Credentials → API key |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Secret | – | Only for "Connect YouTube" (OAuth client, Web application) |
| `CRON_SECRET` | Secret | – | Only if you use `/api/cron` |
| `CERTBOT_EMAIL` | **Variable** | ✅ | Your email, for certificate-expiry notices |
| `DOMAIN` | Variable | – | Defaults to `ytreminder.suryathink.com` |
| `EMAIL_FROM` | Variable | – | Defaults to `YT Reminder <reminders@suryathink.com>` (domain must be verified in Resend) |

`APP_SECRET` is generated on the droplet on the first deploy and kept, so it isn't a secret you need to add.

Before the first deploy: point the `ytreminder` DNS A record at the droplet, and add the droplet's IP in
Atlas → Network Access. The workflow installs Docker, Nginx and Certbot on the droplet if they're missing.

## Deploying by hand on a DigitalOcean droplet (Nginx + Certbot)

The app runs as two Docker containers that listen **only on the droplet itself** (`127.0.0.1`).
Your existing **Nginx** is the public entry, with a free HTTPS certificate from **Certbot**:

```
internet ──443──► Nginx ──/api/*──► 127.0.0.1:4000  server (Express API + email scheduler)
                        └──/ ─────► 127.0.0.1:3000  client (Next.js)
                                                     data ► MongoDB Atlas
```

Data lives in MongoDB Atlas, so there's nothing to back up on the droplet.

### 1. One-time setup

1. **Docker** (if not installed): `curl -fsSL https://get.docker.com | sh`
2. **Swap** on a 1 GB droplet, so the Next.js build doesn't run out of memory:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
3. **Certbot**: `sudo apt install certbot python3-certbot-nginx`
4. **DNS**: add an **A record** (e.g. `reminder.yourdomain.com`) pointing at the droplet's IP.
5. **MongoDB Atlas → Network Access**: add the droplet's IP.
6. **Google Cloud** (only for "Connect YouTube"): authorized redirect URI
   `https://reminder.yourdomain.com/api/auth/google/callback`.

### 2. Start the app

```bash
git clone -b main https://github.com/suryathink/yt-channel-reminder.git
cd yt-channel-reminder
cp .env.example .env                 # only if 3000/4000 are already used on the droplet
cp server/.env.example server/.env
nano server/.env
docker compose up -d --build
```

In `server/.env` set at least:

```
WEB_URL=https://reminder.yourdomain.com
APP_SECRET=<long random string>
MONGODB_URI=mongodb+srv://...
RESEND_API_KEY=re_...
EMAIL_FROM=YT Reminder <reminders@yourdomain.com>
YOUTUBE_API_KEY=...
```

Leave `DISABLE_SCHEDULER=0`: the server is always on, so it sends the emails itself, with no cron needed.

Check it's up: `curl http://127.0.0.1:4000/api/health` should print `{"ok":true}`.

### 3. Nginx site + HTTPS

```bash
sudo cp deploy/nginx/yt-reminder.conf /etc/nginx/sites-available/yt-reminder
sudo sed -i 's/reminder.example.com/reminder.yourdomain.com/' /etc/nginx/sites-available/yt-reminder
sudo ln -s /etc/nginx/sites-available/yt-reminder /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot --nginx -d reminder.yourdomain.com
```

Certbot gets the certificate, adds HTTPS and the HTTP→HTTPS redirect to that site, and renews it automatically.
Check the renewal with `sudo certbot renew --dry-run`.

If you changed `CLIENT_PORT` / `API_PORT` in `.env`, change the two `proxy_pass` ports in the Nginx file to match.

Open `https://reminder.yourdomain.com`, sign in, add a channel, and use **"Send me today's email now"** to check emails.

### 4. Day to day

```bash
docker compose logs -f server              # emails sent, sync errors, etc.
docker compose ps                          # status
git pull && docker compose up -d --build   # deploy an update
```

### Other hosts

The same images run anywhere Docker runs. On hosts that sleep when idle, set `DISABLE_SCHEDULER=1` and `CRON_SECRET`
and call `POST /api/cron` with `Authorization: Bearer <CRON_SECRET>` every 5 minutes.

### How sending works

Emails go out in each user's own time zone. Each slot is recorded in MongoDB, so nobody gets the same email twice,
even if the server restarts. If the server was down at send time, the email still goes out if it comes back within
90 minutes. New uploads are picked up every 12 hours.
