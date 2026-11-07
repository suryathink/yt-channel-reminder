import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  send_times TEXT NOT NULL,
  notion_url TEXT,
  paused INTEGER NOT NULL DEFAULT 0,
  google_refresh_token TEXT,
  yt_playlist_id TEXT,
  created_at TEXT NOT NULL
);

-- YouTube channels, shared across users
CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  handle TEXT,
  thumbnail TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  published_at TEXT,
  thumbnail TEXT,
  duration_seconds INTEGER
);
CREATE INDEX IF NOT EXISTS videos_channel ON videos(channel_id);

CREATE TABLE IF NOT EXISTS watched (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  watched_at TEXT NOT NULL,
  youtube_synced INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, video_id)
);

-- The video chosen for a user + channel on a given local date
CREATE TABLE IF NOT EXISTS daily_picks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  video_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, channel_id, local_date)
);

-- One row per scheduled email actually sent (prevents duplicates)
CREATE TABLE IF NOT EXISTS sends (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  slot TEXT NOT NULL,
  sent_at TEXT NOT NULL,
  PRIMARY KEY (user_id, local_date, slot)
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
`;

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const database = new DatabaseSync(file);
  if (file !== ':memory:') database.exec('PRAGMA journal_mode = WAL;');
  database.exec(SCHEMA);
  return database;
}

export const db = openDb(config.dbPath);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
