import { config } from './config.js';
import { db } from './db.js';

const API = 'https://www.googleapis.com/youtube/v3';
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; yt-channel-reminder/1.0)',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'SOCS=CAI', // skip the EU cookie-consent interstitial
};

/**
 * Accepts anything a person might paste: a full channel URL, "@handle", a bare channel id.
 * Returns { type: 'id' | 'handle' | 'username' | 'custom', value }.
 */
export function parseChannelInput(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Paste a YouTube channel link.');
  if (/^UC[\w-]{22}$/.test(raw)) return { type: 'id', value: raw };
  if (/^@[\w.\-·]+$/.test(raw)) return { type: 'handle', value: raw.slice(1) };

  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    url = null;
  }
  if (url && /(^|\.)youtube\.com$/i.test(url.hostname)) {
    const seg = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (seg[0]?.startsWith('@')) return { type: 'handle', value: seg[0].slice(1) };
    if (seg[0] === 'channel' && /^UC[\w-]{22}$/.test(seg[1] || '')) return { type: 'id', value: seg[1] };
    if (seg[0] === 'user' && seg[1]) return { type: 'username', value: seg[1] };
    if (seg[0] === 'c' && seg[1]) return { type: 'custom', value: seg[1] };
    if (seg.length >= 1 && !['watch', 'shorts', 'playlist', 'results', 'feed'].includes(seg[0])) {
      return { type: 'custom', value: seg[0] };
    }
    throw new Error('That looks like a video or playlist link. Paste the channel link instead (e.g. https://www.youtube.com/@hnasr).');
  }
  if (/^[\w.\-]+$/.test(raw)) return { type: 'handle', value: raw };
  throw new Error('That does not look like a YouTube channel link.');
}

async function api(path, params) {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries({ ...params, key: config.youtubeApiKey })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`YouTube API ${path} failed: ${body.error?.message || res.status}`);
  return body;
}

const bestThumb = (t = {}) => (t.medium || t.high || t.default || {}).url || null;

async function scrapeChannelId(parsed) {
  const path = { id: `channel/${parsed.value}`, handle: `@${parsed.value}`, username: `user/${parsed.value}`, custom: `c/${parsed.value}` }[parsed.type];
  const res = await fetch(`https://www.youtube.com/${path}`, { headers: BROWSER_HEADERS });
  if (res.status === 404) throw new Error('YouTube says that channel does not exist.');
  if (!res.ok) throw new Error(`Could not load the channel page (HTTP ${res.status}).`);
  const page = await res.text();
  const id = page.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1]
    || page.match(/"externalId":"(UC[\w-]{22})"/)?.[1]
    || page.match(/"channelId":"(UC[\w-]{22})"/)?.[1];
  if (!id) throw new Error('Could not find that channel on YouTube.');
  return id;
}

/** Resolves user input to { channelId, title, handle, thumbnail }. */
export async function resolveChannel(input) {
  const parsed = parseChannelInput(input);

  if (config.youtubeApiKey) {
    const lookup = { id: { id: parsed.value }, handle: { forHandle: `@${parsed.value}` }, username: { forUsername: parsed.value } }[parsed.type]
      || { id: await scrapeChannelId(parsed) };
    const data = await api('channels', { part: 'snippet', ...lookup });
    const ch = data.items?.[0];
    if (!ch) throw new Error('Could not find that channel on YouTube.');
    return {
      channelId: ch.id,
      title: ch.snippet.title,
      handle: ch.snippet.customUrl || null,
      thumbnail: bestThumb(ch.snippet.thumbnails),
    };
  }

  const channelId = parsed.type === 'id' ? parsed.value : await scrapeChannelId(parsed);
  const feed = await fetchRss(channelId);
  return { channelId, title: feed.title || channelId, handle: parsed.type === 'handle' ? `@${parsed.value}` : null, thumbnail: null };
}

/** "PT1H2M3S" -> 3723 */
export function parseIsoDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return null;
  const [, d = 0, h = 0, min = 0, s = 0] = m.map((x) => Number(x || 0));
  return d * 86400 + h * 3600 + min * 60 + s;
}

const decodeXml = (s) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export async function fetchRss(channelId) {
  const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Could not load the channel feed (HTTP ${res.status}).`);
  return parseRss(await res.text());
}

export function parseRss(xml) {
  const title = decodeXml(xml.match(/<title>([^<]*)<\/title>/)?.[1] || '');
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    videoId: e.match(/<yt:videoId>([^<]+)</)?.[1],
    title: decodeXml(e.match(/<title>([^<]*)<\/title>/)?.[1] || ''),
    publishedAt: e.match(/<published>([^<]+)</)?.[1] || null,
    thumbnail: e.match(/<media:thumbnail url="([^"]+)"/)?.[1] || null,
    durationSeconds: null,
  })).filter((v) => v.videoId);
  return { title, videos };
}

/** Fetches uploads newer than the ones we already know (all of them on first sync). */
async function fetchUploadsViaApi(channelId, knownIds) {
  const playlistId = `UU${channelId.slice(2)}`;
  const ids = [];
  let pageToken;
  do {
    const page = await api('playlistItems', { part: 'contentDetails', playlistId, maxResults: 50, ...(pageToken && { pageToken }) });
    const pageIds = (page.items || []).map((i) => i.contentDetails.videoId);
    const fresh = pageIds.filter((id) => !knownIds.has(id));
    ids.push(...fresh);
    // Uploads are newest-first, so once a page contains known videos we've caught up.
    if (knownIds.size && fresh.length < pageIds.length) break;
    pageToken = page.nextPageToken;
  } while (pageToken);

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await api('videos', { part: 'snippet,contentDetails', id: ids.slice(i, i + 50).join(',') });
    for (const v of data.items || []) {
      if (v.snippet.liveBroadcastContent && v.snippet.liveBroadcastContent !== 'none') continue; // upcoming/live
      videos.push({
        videoId: v.id,
        title: v.snippet.title,
        publishedAt: v.snippet.publishedAt,
        thumbnail: bestThumb(v.snippet.thumbnails),
        durationSeconds: parseIsoDuration(v.contentDetails.duration),
      });
    }
  }
  return videos;
}

export function upsertChannel(ch) {
  db.prepare(`INSERT INTO channels (channel_id, title, handle, thumbnail) VALUES (?, ?, ?, ?)
    ON CONFLICT(channel_id) DO UPDATE SET title = excluded.title,
      handle = COALESCE(excluded.handle, channels.handle), thumbnail = COALESCE(excluded.thumbnail, channels.thumbnail)`)
    .run(ch.channelId, ch.title, ch.handle, ch.thumbnail);
}

export function saveVideos(channelId, videos) {
  const stmt = db.prepare(`INSERT INTO videos (video_id, channel_id, title, published_at, thumbnail, duration_seconds)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET title = excluded.title, thumbnail = excluded.thumbnail,
      duration_seconds = COALESCE(excluded.duration_seconds, videos.duration_seconds)`);
  for (const v of videos) stmt.run(v.videoId, channelId, v.title, v.publishedAt, v.thumbnail, v.durationSeconds);
}

/** Pulls new uploads for a channel into the database. Returns the number of new videos. */
export async function syncChannel(channelId) {
  const known = new Set(db.prepare('SELECT video_id FROM videos WHERE channel_id = ?').all(channelId).map((r) => r.video_id));
  const videos = config.youtubeApiKey
    ? await fetchUploadsViaApi(channelId, known)
    : (await fetchRss(channelId)).videos;
  const fresh = videos.filter((v) => !known.has(v.videoId));
  saveVideos(channelId, videos);
  db.prepare('UPDATE channels SET last_synced_at = ? WHERE channel_id = ?').run(new Date().toISOString(), channelId);
  return fresh.length;
}

let refreshing = false;
/** Re-syncs channels that haven't been checked recently. Errors are logged, never thrown. */
export async function refreshStaleChannels() {
  if (refreshing) return;
  refreshing = true;
  try {
    const cutoff = new Date(Date.now() - config.channelRefreshHours * 3600_000).toISOString();
    const stale = db.prepare(`SELECT channel_id FROM channels
      WHERE (last_synced_at IS NULL OR last_synced_at < ?)
        AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.channel_id = channels.channel_id)`).all(cutoff);
    for (const { channel_id } of stale) {
      try {
        const n = await syncChannel(channel_id);
        if (n) console.log(`[sync] ${channel_id}: ${n} new videos`);
      } catch (err) {
        console.error(`[sync] ${channel_id} failed:`, err.message);
      }
    }
  } finally {
    refreshing = false;
  }
}
