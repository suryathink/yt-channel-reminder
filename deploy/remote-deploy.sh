#!/usr/bin/env bash
# Runs ON THE DROPLET. Called by .github/workflows/deploy.yml after the code has been copied over.
# Safe to run again and again: each step only does work that's still needed.
#
# Needs: DOMAIN, CERTBOT_EMAIL (env). Expects server/.env.new written by the workflow.
# Optional: SERVER_IMAGE, CLIENT_IMAGE (env): prebuilt images to pull instead of building here.
set -euo pipefail

: "${DOMAIN:?DOMAIN is not set}"
: "${CERTBOT_EMAIL:?CERTBOT_EMAIL is not set}"

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

# Optional host-port overrides (CLIENT_PORT / API_PORT) from the root .env
# shellcheck source=/dev/null
if [ -f .env ]; then set -a; . ./.env; set +a; fi
CLIENT_PORT="${CLIENT_PORT:-3000}"
API_PORT="${API_PORT:-4000}"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi
log() { printf '\n==> %s\n' "$*"; }

# ---------- 1. Prerequisites (installed once) ----------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | $SUDO sh
fi
DOCKER="docker"
docker info >/dev/null 2>&1 || DOCKER="$SUDO docker"

missing=()
command -v nginx >/dev/null 2>&1 || missing+=(nginx)
command -v certbot >/dev/null 2>&1 || missing+=(certbot python3-certbot-nginx)
if [ ${#missing[@]} -gt 0 ]; then
  log "Installing ${missing[*]}"
  $SUDO apt-get update -qq
  $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
fi

# ---------- 2. server/.env ----------
# Values come from GitHub secrets on every deploy. APP_SECRET is generated here once and kept,
# so sign-in sessions and email links keep working across deploys.
log "Writing server/.env"
app_secret=""
if [ -f server/.env ]; then
  app_secret="$(grep -E '^APP_SECRET=' server/.env | head -n1 | cut -d= -f2- || true)"
fi
[ -n "$app_secret" ] || app_secret="$(openssl rand -hex 32)"
umask 077
{ grep -v -E '^APP_SECRET=' server/.env.new; echo "APP_SECRET=$app_secret"; } > server/.env
rm -f server/.env.new

# ---------- 3. Start the containers ----------
# Compose reads ports and image names from this file (works the same with or without sudo).
cat > .deploy.env <<ENV
CLIENT_PORT=${CLIENT_PORT}
API_PORT=${API_PORT}
SERVER_IMAGE=${SERVER_IMAGE:-}
CLIENT_IMAGE=${CLIENT_IMAGE:-}
ENV
COMPOSE="$DOCKER compose --env-file .deploy.env"

if [ -n "${SERVER_IMAGE:-}" ] && [ -n "${CLIENT_IMAGE:-}" ]; then
  log "Pulling $SERVER_IMAGE and $CLIENT_IMAGE"
  $COMPOSE pull server client
  $COMPOSE up -d --no-build --remove-orphans
  # Remove older versions of this app's images (other images on the droplet are left alone).
  # $DOCKER is unquoted on purpose: it may be "sudo -n docker".
  # shellcheck disable=SC2086
  $DOCKER images --format '{{.Repository}}:{{.Tag}}' \
    | grep -E '/yt-reminder-(server|client):' \
    | grep -v -x -F -e "$SERVER_IMAGE" -e "$CLIENT_IMAGE" \
    | xargs -r $DOCKER rmi >/dev/null 2>&1 || true
else
  log "Building and starting containers on this server"
  $COMPOSE up -d --build --remove-orphans
  $DOCKER image prune -f >/dev/null
fi

log "Waiting for the API to be healthy"
healthy=""
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${API_PORT}/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done
if [ -z "$healthy" ]; then
  echo "API did not become healthy. Last server logs:" >&2
  $COMPOSE logs --tail=80 server >&2
  exit 1
fi
echo "API is healthy."

# ---------- 4. Nginx site (created once; Certbot edits it afterwards) ----------
SITE=/etc/nginx/sites-available/yt-reminder
if [ ! -f "$SITE" ]; then
  log "Creating Nginx site for $DOMAIN"
  sed -e "s/reminder\.example\.com/${DOMAIN}/" \
      -e "s#127\.0\.0\.1:3000#127.0.0.1:${CLIENT_PORT}#" \
      -e "s#127\.0\.0\.1:4000#127.0.0.1:${API_PORT}#" \
      deploy/nginx/yt-reminder.conf | $SUDO tee "$SITE" >/dev/null
  $SUDO ln -sf "$SITE" /etc/nginx/sites-enabled/yt-reminder
fi
$SUDO nginx -t
$SUDO systemctl reload nginx

# ---------- 5. HTTPS certificate (requested once; Certbot renews it automatically) ----------
if ! $SUDO test -d "/etc/letsencrypt/live/${DOMAIN}"; then
  log "Requesting HTTPS certificate for $DOMAIN"
  $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
fi

log "Deployed: https://${DOMAIN}"
