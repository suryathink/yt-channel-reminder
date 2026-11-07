import { config } from './config.js';
import { col, isDuplicateKey } from './db.js';
import { addToWatchedPlaylist } from './google.js';

/** Videos that may be suggested: not Shorts (unknown duration is allowed, e.g. from RSS). */
const eligible = (channelId) => ({
  channelId,
  $or: [{ durationSeconds: null }, { durationSeconds: { $gte: config.minVideoSeconds } }],
});

export const getVideo = (videoId) => col.videos.findOne({ _id: videoId });

export const isWatched = async (userId, videoId) => Boolean(await col.watched.findOne({ userId, videoId }));

/**
 * Today's video for this user + channel. The same video is kept for the whole day
 * (morning email and evening reminder) unless it gets marked as watched, then a new one is chosen.
 * Prefers videos that have never been suggested before. Returns null when everything is watched.
 */
export async function getOrCreatePick(userId, channelId, localDate, rng = Math.random) {
  const existing = await col.dailyPicks.findOne({ userId, channelId, localDate });
  if (existing && !(await isWatched(userId, existing.videoId))) {
    const video = await getVideo(existing.videoId);
    if (video) return video;
  }

  const [ids, watchedIds, suggestedIds] = await Promise.all([
    col.videos.distinct('_id', eligible(channelId)),
    col.watched.distinct('videoId', { userId }),
    col.dailyPicks.distinct('videoId', { userId, channelId }),
  ]);
  const watched = new Set(watchedIds);
  const candidates = ids.filter((id) => !watched.has(id)).sort();
  if (!candidates.length) return null;

  const suggested = new Set(suggestedIds);
  const fresh = candidates.filter((id) => !suggested.has(id));
  const pool = fresh.length ? fresh : candidates;
  const videoId = pool[Math.floor(rng() * pool.length)];

  try {
    await col.dailyPicks.updateOne(
      { userId, channelId, localDate },
      { $set: { videoId, createdAt: new Date() } },
      { upsert: true },
    );
  } catch (err) {
    // Two requests raced to create today's pick; use the one that won.
    if (!isDuplicateKey(err)) throw err;
    return getOrCreatePick(userId, channelId, localDate, rng);
  }
  return getVideo(videoId);
}

export async function channelProgress(userId, channelId) {
  const ids = await col.videos.distinct('_id', eligible(channelId));
  const watched = ids.length ? await col.watched.countDocuments({ userId, videoId: { $in: ids } }) : 0;
  return { total: ids.length, watched };
}

/**
 * Marks a video as watched. If the user connected YouTube, also adds it to their
 * private "Watched" playlist. Returns 'synced' | 'not_connected' | 'failed'.
 */
export async function markWatched(user, videoId) {
  const res = await col.watched.findOneAndUpdate(
    { userId: user._id, videoId },
    { $setOnInsert: { watchedAt: new Date(), youtubeSynced: false } },
    { upsert: true, returnDocument: 'after' },
  );
  if (!user.googleRefreshToken) return 'not_connected';
  if (res?.youtubeSynced) return 'synced';
  try {
    await addToWatchedPlaylist(user, videoId);
    await col.watched.updateOne({ userId: user._id, videoId }, { $set: { youtubeSynced: true } });
    return 'synced';
  } catch (err) {
    console.error(`[youtube] could not add ${videoId} to playlist for user ${user._id}:`, err.message);
    return 'failed';
  }
}

export const unmarkWatched = (userId, videoId) => col.watched.deleteOne({ userId, videoId });
