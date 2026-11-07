// Optional "Connect YouTube" integration.
// YouTube's API cannot read or write watch history, so "mark as watched on YouTube"
// is implemented as adding the video to a private "Watched" playlist on the user's account.
import { config } from './config.js';
import { col } from './db.js';

const SCOPE = 'https://www.googleapis.com/auth/youtube';
// Goes through the Next.js /api proxy, so register <WEB_URL>/api/auth/google/callback in Google Cloud.
const redirectUri = () => `${config.webUrl}/api/auth/google/callback`;
const PLAYLIST_TITLE = 'Watched ✓ (YT Reminder)';

export function authUrl(state) {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.googleClientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return url.toString();
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google token request failed: ${body.error_description || body.error || res.status}`);
  return body;
}

export async function exchangeCode(code) {
  const tokens = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and try again.');
  return tokens.refresh_token;
}

async function accessToken(user) {
  return (await tokenRequest({ refresh_token: user.googleRefreshToken, grant_type: 'refresh_token' })).access_token;
}

async function yt(token, path, body) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `YouTube API error ${res.status}`);
    err.status = res.status;
    err.reason = json.error?.errors?.[0]?.reason;
    throw err;
  }
  return json;
}

async function createPlaylist(user, token) {
  const pl = await yt(token, 'playlists?part=snippet,status', {
    snippet: { title: PLAYLIST_TITLE, description: 'Videos I have marked as watched in YT Reminder.' },
    status: { privacyStatus: 'private' },
  });
  await col.users.updateOne({ _id: user._id }, { $set: { ytPlaylistId: pl.id } });
  user.ytPlaylistId = pl.id;
  return pl.id;
}

/** Adds the video to the user's private "Watched" playlist on YouTube. */
export async function addToWatchedPlaylist(user, videoId) {
  const token = await accessToken(user);
  const insert = (playlistId) => yt(token, 'playlistItems?part=snippet', {
    snippet: { playlistId, resourceId: { kind: 'youtube#video', videoId } },
  });
  const playlistId = user.ytPlaylistId || await createPlaylist(user, token);
  try {
    await insert(playlistId);
  } catch (err) {
    if (err.status !== 404 || err.reason !== 'playlistNotFound') throw err;
    await insert(await createPlaylist(user, token)); // user deleted the playlist; make a new one
  }
}
