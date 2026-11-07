import { MongoClient, ObjectId } from 'mongodb';
import { config } from './config.js';

let client;
let database;

/**
 * Collections
 *   users          { _id, email, timezone, sendTimes[], notionUrl, paused, googleRefreshToken, ytPlaylistId, createdAt }
 *   channels       { _id: YouTube channel id, title, handle, thumbnail, lastSyncedAt }   (shared across users)
 *   subscriptions  { userId, channelId, createdAt }
 *   videos         { _id: YouTube video id, channelId, title, publishedAt, thumbnail, durationSeconds }
 *   watched        { userId, videoId, watchedAt, youtubeSynced }
 *   dailyPicks     { userId, channelId, localDate, videoId, createdAt }   the video chosen for a day
 *   sends          { userId, localDate, slot, sentAt }   one per scheduled email (prevents duplicates)
 *   loginTokens    { _id: sha256(token), email, expiresAt, createdAt }
 *   sessions       { _id: sha256(token), userId, expiresAt }
 */
export const col = {
  get users() { return database.collection('users'); },
  get channels() { return database.collection('channels'); },
  get subscriptions() { return database.collection('subscriptions'); },
  get videos() { return database.collection('videos'); },
  get watched() { return database.collection('watched'); },
  get dailyPicks() { return database.collection('dailyPicks'); },
  get sends() { return database.collection('sends'); },
  get loginTokens() { return database.collection('loginTokens'); },
  get sessions() { return database.collection('sessions'); },
};

async function ensureIndexes() {
  await Promise.all([
    col.users.createIndex({ email: 1 }, { unique: true }),
    col.subscriptions.createIndex({ userId: 1, channelId: 1 }, { unique: true }),
    col.subscriptions.createIndex({ channelId: 1 }),
    col.videos.createIndex({ channelId: 1 }),
    col.watched.createIndex({ userId: 1, videoId: 1 }, { unique: true }),
    col.watched.createIndex({ userId: 1, watchedAt: -1 }),
    col.dailyPicks.createIndex({ userId: 1, channelId: 1, localDate: 1 }, { unique: true }),
    col.sends.createIndex({ userId: 1, localDate: 1, slot: 1 }, { unique: true }),
    col.loginTokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    col.loginTokens.createIndex({ email: 1, createdAt: -1 }),
    col.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export async function connectDb(uri = config.mongoUri, dbName = config.mongoDb) {
  client = new MongoClient(uri);
  await client.connect();
  database = client.db(dbName);
  await ensureIndexes();
  return database;
}

export async function closeDb() {
  await client?.close();
  client = undefined;
  database = undefined;
}

export const isDuplicateKey = (err) => err?.code === 11000;

/** Parses a user id from a token/cookie. Returns null if it isn't a valid ObjectId. */
export const toObjectId = (id) => (typeof id === 'string' && ObjectId.isValid(id) ? new ObjectId(id) : null);
