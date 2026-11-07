import { config } from './config.js';
import { db } from './db.js';
import { sendEmail } from './email.js';
import { renderLoginEmail } from './emailTemplates.js';
import { randomToken, sha256 } from './tokens.js';

const COOKIE = 'ytr_session';
const SESSION_DAYS = 60;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function requestLoginLink(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error('Enter a valid email address.');
  const recent = db.prepare('SELECT 1 FROM login_tokens WHERE email = ? AND created_at > ?')
    .get(email, new Date(Date.now() - 60_000).toISOString());
  if (recent) return email; // at most one link per minute per address
  db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').run(new Date().toISOString());
  const token = randomToken();
  db.prepare('INSERT INTO login_tokens (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), email, new Date(Date.now() + 15 * 60_000).toISOString(), new Date().toISOString());
  await sendEmail({ to: email, ...renderLoginEmail(`${config.appUrl}/auth/verify?token=${token}`) });
  return email;
}

export const loginTokenValid = (token) => Boolean(token && db.prepare('SELECT 1 FROM login_tokens WHERE token_hash = ? AND expires_at > ?')
  .get(sha256(token), new Date().toISOString()));

/** Consumes a login token, creating the user on first login. Returns the user or null. */
export function consumeLoginToken(token) {
  if (!token) return null;
  const row = db.prepare('SELECT * FROM login_tokens WHERE token_hash = ? AND expires_at > ?').get(sha256(token), new Date().toISOString());
  if (!row) return null;
  db.prepare('DELETE FROM login_tokens WHERE token_hash = ?').run(row.token_hash);
  db.prepare(`INSERT OR IGNORE INTO users (email, timezone, send_times, created_at) VALUES (?, ?, ?, ?)`)
    .run(row.email, config.defaultTimezone, config.defaultSendTimes, new Date().toISOString());
  return db.prepare('SELECT * FROM users WHERE email = ?').get(row.email);
}

const cookieOpts = () => ({
  httpOnly: true, sameSite: 'lax', secure: config.appUrl.startsWith('https://'), path: '/', maxAge: SESSION_DAYS * 86400_000,
});

export function startSession(res, userId) {
  const token = randomToken();
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString());
  res.cookie(COOKIE, token, cookieOpts());
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.clearCookie(COOKIE, { path: '/' });
}

/** Express middleware: sets req.user if the session cookie is valid. */
export function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  req.user = token ? db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`).get(sha256(token), new Date().toISOString()) : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.redirect('/');
  next();
}
