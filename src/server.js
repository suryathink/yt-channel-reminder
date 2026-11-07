import express from 'express';
import { config, googleEnabled } from './config.js';
import { db } from './db.js';
import {
  consumeLoginToken, endSession, loadUser, loginTokenValid, requestLoginLink, requireUser, startSession,
} from './auth.js';
import { authUrl, exchangeCode } from './google.js';
import { channelProgress, getOrCreatePick, getVideo, markWatched, unmarkWatched } from './picker.js';
import { sendNow, tick, userChannels } from './reminders.js';
import { isValidTimezone, localParts, parseSendTimes } from './time.js';
import { sign, verify } from './tokens.js';
import {
  checkInboxPage, confirmPage, dashboardPage, landingPage, messagePage,
} from './views.js';
import { resolveChannel, syncChannel, upsertChannel } from './youtube.js';

const TIMEZONES = Intl.supportedValuesOf('timeZone');
const back = (res, kind, msg) => res.redirect(`/dashboard?${kind}=${encodeURIComponent(msg)}`);
const flashFrom = (q) => (q.error ? { error: String(q.error) } : q.ok ? { ok: String(q.ok) } : null);

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(loadUser);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  // ---------- Auth (passwordless email link) ----------
  app.get('/', (req, res) => (req.user ? res.redirect('/dashboard') : res.send(landingPage(flashFrom(req.query)))));

  app.post('/login', async (req, res) => {
    try {
      const email = await requestLoginLink(req.body.email);
      res.send(checkInboxPage(email));
    } catch (err) {
      console.error('[login]', err.message);
      res.status(400).send(landingPage({ error: err.message.startsWith('Enter') ? err.message : 'Could not send the sign-in email. Try again in a minute.' }));
    }
  });

  // GET only shows a button: email scanners that pre-open links must not use up the token.
  app.get('/auth/verify', (req, res) => {
    const token = String(req.query.token || '');
    if (!loginTokenValid(token)) return res.status(400).send(landingPage({ error: 'That sign-in link is invalid or expired. Request a new one.' }));
    res.send(confirmPage('Sign in', 'Click below to finish signing in.', `/auth/verify?token=${encodeURIComponent(token)}`, 'Sign in'));
  });

  app.post('/auth/verify', (req, res) => {
    const user = consumeLoginToken(String(req.query.token || ''));
    if (!user) return res.status(400).send(landingPage({ error: 'That sign-in link is invalid or expired. Request a new one.' }));
    startSession(res, user.id);
    res.redirect('/dashboard');
  });

  app.post('/logout', (req, res) => {
    endSession(req, res);
    res.redirect('/');
  });

  // ---------- Dashboard ----------
  app.get('/dashboard', requireUser, (req, res) => {
    const { user } = req;
    const { date } = localParts(new Date(), user.timezone);
    const subs = userChannels(user.id);
    const channels = subs.map((channel) => ({ channel, progress: channelProgress(user.id, channel.channel_id) }));
    const picks = channels.map(({ channel, progress }) => ({
      channel, progress, video: getOrCreatePick(user.id, channel.channel_id, date),
    }));
    const recent = db.prepare(`SELECT w.video_id, w.watched_at, COALESCE(v.title, w.video_id) AS title FROM watched w
      LEFT JOIN videos v ON v.video_id = w.video_id WHERE w.user_id = ? ORDER BY w.watched_at DESC LIMIT 10`).all(user.id);
    res.send(dashboardPage({ user, channels, picks, recent, timezones: TIMEZONES, flash: flashFrom(req.query) }));
  });

  app.post('/channels', requireUser, async (req, res) => {
    try {
      const ch = await resolveChannel(req.body.channel);
      upsertChannel(ch);
      db.prepare('INSERT OR IGNORE INTO subscriptions (user_id, channel_id, created_at) VALUES (?, ?, ?)')
        .run(req.user.id, ch.channelId, new Date().toISOString());
      await syncChannel(ch.channelId);
      const { total } = channelProgress(req.user.id, ch.channelId);
      back(res, 'ok', `Added ${ch.title} (${total} videos).${config.youtubeApiKey ? '' : ' Note: without a YouTube API key only the latest 15 videos are available.'}`);
    } catch (err) {
      console.error('[channels]', err.message);
      back(res, 'error', err.message);
    }
  });

  app.post('/channels/:id/sync', requireUser, async (req, res) => {
    const sub = db.prepare('SELECT 1 FROM subscriptions WHERE user_id = ? AND channel_id = ?').get(req.user.id, req.params.id);
    if (!sub) return back(res, 'error', 'Channel not found.');
    try {
      const n = await syncChannel(req.params.id);
      back(res, 'ok', n ? `Found ${n} new videos.` : 'Already up to date.');
    } catch (err) {
      back(res, 'error', err.message);
    }
  });

  app.post('/channels/:id/delete', requireUser, (req, res) => {
    db.prepare('DELETE FROM subscriptions WHERE user_id = ? AND channel_id = ?').run(req.user.id, req.params.id);
    back(res, 'ok', 'Channel removed.');
  });

  app.post('/settings', requireUser, (req, res) => {
    try {
      const timezone = String(req.body.timezone || '');
      if (!isValidTimezone(timezone)) throw new Error('Pick a valid time zone.');
      const times = parseSendTimes(req.body.send_times);
      let notion = String(req.body.notion_url || '').trim() || null;
      if (notion && !/^https:\/\//i.test(notion)) throw new Error('The Notion link must start with https://');
      db.prepare('UPDATE users SET timezone = ?, send_times = ?, notion_url = ?, paused = ? WHERE id = ?')
        .run(timezone, times.join(','), notion, req.body.paused ? 1 : 0, req.user.id);
      back(res, 'ok', 'Settings saved.');
    } catch (err) {
      back(res, 'error', err.message);
    }
  });

  app.post('/send-now', requireUser, async (req, res) => {
    try {
      const r = await sendNow(req.user);
      back(res, r.sent ? 'ok' : 'error', r.sent ? `Sent to ${req.user.email}.` : `Nothing to send (${r.reason}).`);
    } catch (err) {
      console.error('[send-now]', err.message);
      back(res, 'error', `Sending failed: ${err.message}`);
    }
  });

  const ytMessage = (status) => ({
    synced: ' Also added to your "Watched" playlist on YouTube.',
    failed: ' (Could not update your YouTube playlist. Try reconnecting YouTube.)',
    not_connected: '',
  }[status]);

  app.post('/videos/:id/watched', requireUser, async (req, res) => {
    const status = await markWatched(req.user, req.params.id);
    back(res, 'ok', `Marked as watched. It won't be suggested again.${ytMessage(status)}`);
  });

  app.post('/videos/:id/unwatch', requireUser, (req, res) => {
    unmarkWatched(req.user.id, req.params.id);
    back(res, 'ok', 'Moved back to your unwatched list.');
  });

  // ---------- One-click links from emails (signed, work without being signed in) ----------
  const tokenUser = (token, action) => {
    const p = verify(token);
    if (!p || p.a !== action) return null;
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(p.u);
    return user ? { user, payload: p } : null;
  };

  app.get('/w/:token', (req, res) => {
    const t = tokenUser(req.params.token, 'w');
    if (!t) return res.status(400).send(messagePage('Invalid link', 'This link is invalid.'));
    const video = getVideo(t.payload.v);
    res.send(confirmPage('Mark as watched?', `"${video?.title || t.payload.v}" won't be suggested to you again.`,
      `/w/${req.params.token}`, "✓ Yes, I've watched it", req.user));
  });

  app.post('/w/:token', async (req, res) => {
    const t = tokenUser(req.params.token, 'w');
    if (!t) return res.status(400).send(messagePage('Invalid link', 'This link is invalid.'));
    const status = await markWatched(t.user, t.payload.v);
    res.send(messagePage('Marked as watched ✓', `Nice work! It won't be suggested again.${ytMessage(status)} Don't forget to write your notes in Notion. 📝`, req.user));
  });

  app.get('/u/:token', (req, res) => {
    const t = tokenUser(req.params.token, 'u');
    if (!t) return res.status(400).send(messagePage('Invalid link', 'This link is invalid.'));
    res.send(confirmPage('Pause reminder emails?', `You'll stop getting reminders at ${t.user.email}. You can turn them back on from your dashboard.`,
      `/u/${req.params.token}`, 'Pause emails', req.user));
  });

  app.post('/u/:token', (req, res) => {
    const t = tokenUser(req.params.token, 'u');
    if (!t) return res.status(400).send(messagePage('Invalid link', 'This link is invalid.'));
    db.prepare('UPDATE users SET paused = 1 WHERE id = ?').run(t.user.id);
    res.send(messagePage('Emails paused', 'You will not get any more reminders until you turn them back on in settings.', req.user));
  });

  // ---------- Connect YouTube (optional) ----------
  app.get('/auth/google/start', requireUser, (req, res) => {
    if (!googleEnabled()) return back(res, 'error', 'YouTube connection is not configured on this server.');
    res.redirect(authUrl(sign({ a: 'g', u: req.user.id, exp: Date.now() + 10 * 60_000 })));
  });

  app.get('/auth/google/callback', requireUser, async (req, res) => {
    const state = verify(String(req.query.state || ''));
    if (!state || state.a !== 'g' || state.u !== req.user.id) return back(res, 'error', 'YouTube connection failed (bad state). Try again.');
    if (req.query.error) return back(res, 'error', `YouTube connection cancelled (${req.query.error}).`);
    try {
      const refreshToken = await exchangeCode(String(req.query.code || ''));
      db.prepare('UPDATE users SET google_refresh_token = ? WHERE id = ?').run(refreshToken, req.user.id);
      back(res, 'ok', 'YouTube connected. Videos you mark as watched will go to a private "Watched" playlist.');
    } catch (err) {
      back(res, 'error', err.message);
    }
  });

  app.post('/auth/google/disconnect', requireUser, (req, res) => {
    db.prepare('UPDATE users SET google_refresh_token = NULL WHERE id = ?').run(req.user.id);
    back(res, 'ok', 'YouTube disconnected.');
  });

  // ---------- External cron (for hosts that sleep / serverless) ----------
  app.all('/cron', async (req, res) => {
    const given = req.get('authorization')?.replace(/^Bearer\s+/i, '') || req.query.secret;
    if (!config.cronSecret || given !== config.cronSecret) return res.status(401).json({ error: 'unauthorized' });
    res.json({ results: await tick() });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).send(messagePage('Something went wrong', 'Please try again.'));
  });

  return app;
}
