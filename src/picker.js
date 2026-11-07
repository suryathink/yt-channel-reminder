import { config } from './config.js';
import { db } from './db.js';
import { addToWatchedPlaylist } from './google.js';

const eligible = `v.channel_id = ? AND (v.duration_seconds IS NULL OR v.duration_seconds >= ?)`;

export const getVideo = (videoId) => db.prepare('SELECT * FROM videos WHERE video_id = ?').get(videoId);

export const isWatched = (userId, videoId) =>
  Boolean(db.prepare('SELECT 1 FROM watched WHERE user_id = ? AND video_id = ?').get(userId, videoId));

/**
 * Today's video for this user + channel. The same video is kept for the whole day
 * (morning email and evening reminder) unless it gets marked as watched, then a new one is chosen.
 * Prefers videos that have never been suggested before. Returns null when everything is watched.
 */
export function getOrCreatePick(userId, channelId, localDate, rng = Math.random) {
  const existing = db.prepare('SELECT video_id FROM daily_picks WHERE user_id = ? AND channel_id = ? AND local_date = ?')
    .get(userId, channelId, localDate);
  if (existing && !isWatched(userId, existing.video_id)) {
    const video = getVideo(existing.video_id);
    if (video) return video;
  }

  const candidates = db.prepare(`SELECT v.* FROM videos v WHERE ${eligible}
      AND NOT EXISTS (SELECT 1 FROM watched w WHERE w.user_id = ? AND w.video_id = v.video_id)
    ORDER BY v.video_id`).all(channelId, config.minVideoSeconds, userId);
  if (!candidates.length) return null;

  const suggested = new Set(db.prepare('SELECT video_id FROM daily_picks WHERE user_id = ? AND channel_id = ?')
    .all(userId, channelId).map((r) => r.video_id));
  const fresh = candidates.filter((v) => !suggested.has(v.video_id));
  const pool = fresh.length ? fresh : candidates;
  const video = pool[Math.floor(rng() * pool.length)];

  db.prepare(`INSERT INTO daily_picks (user_id, channel_id, local_date, video_id, created_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, channel_id, local_date) DO UPDATE SET video_id = excluded.video_id, created_at = excluded.created_at`)
    .run(userId, channelId, localDate, video.video_id, new Date().toISOString());
  return video;
}

export function channelProgress(userId, channelId) {
  return db.prepare(`SELECT COUNT(*) AS total,
      SUM(EXISTS (SELECT 1 FROM watched w WHERE w.user_id = ? AND w.video_id = v.video_id)) AS watched
    FROM videos v WHERE ${eligible}`).get(userId, channelId, config.minVideoSeconds);
}

/**
 * Marks a video as watched. If the user connected YouTube, also adds it to their
 * private "Watched" playlist. Returns 'synced' | 'not_connected' | 'failed'.
 */
export async function markWatched(user, videoId) {
  db.prepare('INSERT OR IGNORE INTO watched (user_id, video_id, watched_at) VALUES (?, ?, ?)')
    .run(user.id, videoId, new Date().toISOString());
  if (!user.google_refresh_token) return 'not_connected';
  const row = db.prepare('SELECT youtube_synced FROM watched WHERE user_id = ? AND video_id = ?').get(user.id, videoId);
  if (row?.youtube_synced) return 'synced';
  try {
    await addToWatchedPlaylist(user, videoId);
    db.prepare('UPDATE watched SET youtube_synced = 1 WHERE user_id = ? AND video_id = ?').run(user.id, videoId);
    return 'synced';
  } catch (err) {
    console.error(`[youtube] could not add ${videoId} to playlist for user ${user.id}:`, err.message);
    return 'failed';
  }
}

export function unmarkWatched(userId, videoId) {
  db.prepare('DELETE FROM watched WHERE user_id = ? AND video_id = ?').run(userId, videoId);
}
