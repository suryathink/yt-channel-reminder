import { config } from './config.js';
import { col, isDuplicateKey } from './db.js';
import { sendEmail } from './email.js';
import { renderLoginEmail } from './emailTemplates.js';
import { parseSendTimes } from './time.js';
import { randomToken, sha256 } from './tokens.js';

const COOKIE = 'ytr_session';
const SESSION_DAYS = 60;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserError extends Error {}

export async function requestLoginLink(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new UserError('Enter a valid email address.');
  const recent = await col.loginTokens.findOne({ email, createdAt: { $gt: new Date(Date.now() - 60_000) } });
  if (recent) return email; // at most one link per minute per address
  const token = randomToken();
  await col.loginTokens.insertOne({
    _id: sha256(token), email, createdAt: new Date(), expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  await sendEmail({ to: email, ...renderLoginEmail(`${config.webUrl}/auth/verify?token=${encodeURIComponent(token)}`) });
  return email;
}

/** Consumes a single-use login token, creating the user on first login. Returns the user or null. */
export async function consumeLoginToken(token) {
  if (!token) return null;
  const row = await col.loginTokens.findOneAndDelete({ _id: sha256(token), expiresAt: { $gt: new Date() } });
  if (!row) return null;
  try {
    await col.users.updateOne(
      { email: row.email },
      {
        $setOnInsert: {
          email: row.email,
          timezone: config.defaultTimezone,
          sendTimes: parseSendTimes(config.defaultSendTimes),
          notionUrl: null,
          paused: false,
          googleRefreshToken: null,
          ytPlaylistId: null,
          createdAt: new Date(),
        },
      },
      { upsert: true },
    );
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
  }
  return col.users.findOne({ email: row.email });
}

const cookieOpts = () => ({
  httpOnly: true, sameSite: 'lax', secure: config.webUrl.startsWith('https://'), path: '/', maxAge: SESSION_DAYS * 86400_000,
});

export async function startSession(res, userId) {
  const token = randomToken();
  await col.sessions.insertOne({ _id: sha256(token), userId, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) });
  res.cookie(COOKIE, token, cookieOpts());
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function endSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await col.sessions.deleteOne({ _id: sha256(token) });
  res.clearCookie(COOKIE, { path: '/' });
}

/** Express middleware: sets req.user if the session cookie is valid. */
export async function loadUser(req, _res, next) {
  req.user = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const session = await col.sessions.findOne({ _id: sha256(token), expiresAt: { $gt: new Date() } });
    if (session) req.user = await col.users.findOne({ _id: session.userId });
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}
