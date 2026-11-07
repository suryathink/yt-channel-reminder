import express from 'express';
import { config, googleEnabled } from './config.js';
import { col, toObjectId } from './db.js';
import {
  UserError, consumeLoginToken, endSession, loadUser, requestLoginLink, requireUser, startSession,
} from './auth.js';
import { authUrl, exchangeCode } from './google.js';
import { channelProgress, getVideo, markWatched, unmarkWatched } from './picker.js';
import { sendNow, tick, todayItems } from './reminders.js';
import { isValidTimezone, localParts, parseSendTimes } from './time.js';
import { sign, verify } from './tokens.js';
import { resolveChannel, syncChannel, upsertChannel } from './youtube.js';

// ---------- JSON shapes sent to the frontend ----------
const userJson = (u) => ({
  email: u.email,
  timezone: u.timezone,
  sendTimes: u.sendTimes,
  notionUrl: u.notionUrl || '',
  paused: Boolean(u.paused),
  youtubeConnected: Boolean(u.googleRefreshToken),
});
const channelJson = (c) => ({ id: c._id, title: c.title, handle: c.handle || null, thumbnail: c.thumbnail || null });
const videoJson = (v) => v && ({
  id: v._id, title: v.title, thumbnail: v.thumbnail || null, durationSeconds: v.durationSeconds ?? null,
  url: `https://www.youtube.com/watch?v=${v._id}`,
});
const features = () => ({ youtubeConnect: googleEnabled(), fullChannelHistory: Boolean(config.youtubeApiKey) });

const YT_MESSAGE = {
  synced: ' Also added to your "Watched" playlist on YouTube.',
  failed: ' (Could not update your YouTube playlist. Try reconnecting YouTube.)',
  not_connected: '',
};

const fail = (res, status, error) => res.status(status).json({ error });
const webRedirect = (res, path, kind, msg) => res.redirect(`${config.webUrl}${path}?${kind}=${encodeURIComponent(msg)}`);

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '20kb' }));

  const api = express.Router();
  api.use(loadUser);

  api.get('/health', (_req, res) => res.json({ ok: true }));

  // ---------- Auth (passwordless email link) ----------
  api.post('/auth/login', async (req, res) => {
    try {
      res.json({ ok: true, email: await requestLoginLink(req.body?.email) });
    } catch (err) {
      if (err instanceof UserError) return fail(res, 400, err.message);
      console.error('[login]', err.message);
      fail(res, 502, 'Could not send the sign-in email. Try again in a minute.');
    }
  });

  api.post('/auth/verify', async (req, res) => {
    const user = await consumeLoginToken(String(req.body?.token || ''));
    if (!user) return fail(res, 400, 'That sign-in link is invalid or expired. Request a new one.');
    await startSession(res, user._id);
    res.json({ ok: true });
  });

  api.post('/auth/logout', async (req, res) => {
    await endSession(req, res);
    res.json({ ok: true });
  });

  api.get('/me', requireUser, (req, res) => res.json({ user: userJson(req.user), features: features() }));

  // ---------- Dashboard ----------
  api.get('/dashboard', requireUser, async (req, res) => {
    const { user } = req;
    const { date } = localParts(new Date(), user.timezone);
    const items = await todayItems(user, date);
    const recent = await col.watched.find({ userId: user._id }).sort({ watchedAt: -1 }).limit(10).toArray();
    const titles = new Map((await col.videos.find({ _id: { $in: recent.map((r) => r.videoId) } }, { projection: { title: 1 } }).toArray())
      .map((v) => [v._id, v.title]));
    res.json({
      user: userJson(user),
      features: features(),
      today: items.map((i) => ({ channel: channelJson(i.channel), video: videoJson(i.video), progress: i.progress })),
      recent: recent.map((r) => ({
        videoId: r.videoId, title: titles.get(r.videoId) || r.videoId, watchedAt: r.watchedAt,
        url: `https://www.youtube.com/watch?v=${r.videoId}`,
      })),
    });
  });

  api.post('/channels', requireUser, async (req, res) => {
    try {
      const ch = await resolveChannel(req.body?.channel);
      await upsertChannel(ch);
      await col.subscriptions.updateOne(
        { userId: req.user._id, channelId: ch.channelId },
        { $setOnInsert: { createdAt: new Date() } },
        { upsert: true },
      );
      await syncChannel(ch.channelId);
      const { total } = await channelProgress(req.user._id, ch.channelId);
      res.json({
        ok: true,
        message: `Added ${ch.title} (${total} videos).${config.youtubeApiKey ? '' : ' Without a YouTube API key on the server only the latest 15 videos are available.'}`,
      });
    } catch (err) {
      console.error('[channels]', err.message);
      fail(res, 400, err.message);
    }
  });

  const ownsChannel = (req) => col.subscriptions.findOne({ userId: req.user._id, channelId: req.params.id });

  api.post('/channels/:id/sync', requireUser, async (req, res) => {
    if (!(await ownsChannel(req))) return fail(res, 404, 'Channel not found.');
    try {
      const n = await syncChannel(req.params.id);
      res.json({ ok: true, message: n ? `Found ${n} new videos.` : 'Already up to date.' });
    } catch (err) {
      fail(res, 502, err.message);
    }
  });

  api.delete('/channels/:id', requireUser, async (req, res) => {
    await col.subscriptions.deleteOne({ userId: req.user._id, channelId: req.params.id });
    res.json({ ok: true, message: 'Channel removed.' });
  });

  api.patch('/settings', requireUser, async (req, res) => {
    try {
      const body = req.body || {};
      const update = {};
      if (body.timezone !== undefined) {
        if (!isValidTimezone(String(body.timezone))) throw new UserError('Pick a valid time zone.');
        update.timezone = String(body.timezone);
      }
      if (body.sendTimes !== undefined) {
        update.sendTimes = parseSendTimes(Array.isArray(body.sendTimes) ? body.sendTimes.join(',') : body.sendTimes);
      }
      if (body.notionUrl !== undefined) {
        const url = String(body.notionUrl || '').trim();
        if (url && !/^https:\/\//i.test(url)) throw new UserError('The Notion link must start with https://');
        update.notionUrl = url || null;
      }
      if (body.paused !== undefined) update.paused = Boolean(body.paused);
      await col.users.updateOne({ _id: req.user._id }, { $set: update });
      res.json({ ok: true, user: userJson({ ...req.user, ...update }) });
    } catch (err) {
      fail(res, 400, err.message);
    }
  });

  api.post('/send-now', requireUser, async (req, res) => {
    try {
      const r = await sendNow(req.user);
      if (!r.sent) return fail(res, 400, `Nothing to send (${r.reason}).`);
      res.json({ ok: true, message: `Sent to ${req.user.email}.` });
    } catch (err) {
      console.error('[send-now]', err.message);
      fail(res, 502, `Sending failed: ${err.message}`);
    }
  });

  api.post('/videos/:id/watched', requireUser, async (req, res) => {
    const status = await markWatched(req.user, req.params.id);
    res.json({ ok: true, youtube: status, message: `Marked as watched. It won't be suggested again.${YT_MESSAGE[status]}` });
  });

  api.delete('/videos/:id/watched', requireUser, async (req, res) => {
    await unmarkWatched(req.user._id, req.params.id);
    res.json({ ok: true, message: 'Moved back to your unwatched list.' });
  });

  // ---------- One-click links from emails (signed; work without being signed in) ----------
  const linkTarget = async (token) => {
    const p = verify(token);
    if (!p || !['w', 'u'].includes(p.a)) return null;
    const id = toObjectId(p.u);
    const user = id && await col.users.findOne({ _id: id });
    return user ? { user, payload: p } : null;
  };

  api.get('/links/:token', async (req, res) => {
    const t = await linkTarget(req.params.token);
    if (!t) return fail(res, 400, 'This link is invalid.');
    if (t.payload.a === 'u') return res.json({ action: 'pause', email: t.user.email, paused: Boolean(t.user.paused) });
    const video = await getVideo(t.payload.v);
    res.json({
      action: 'watched',
      email: t.user.email,
      video: videoJson(video) || { id: t.payload.v, title: t.payload.v, url: `https://www.youtube.com/watch?v=${t.payload.v}` },
      alreadyWatched: Boolean(await col.watched.findOne({ userId: t.user._id, videoId: t.payload.v })),
    });
  });

  // POST does the action. GET only describes it, so email link scanners can't trigger it.
  api.post('/links/:token', async (req, res) => {
    const t = await linkTarget(req.params.token);
    if (!t) return fail(res, 400, 'This link is invalid.');
    if (t.payload.a === 'u') {
      await col.users.updateOne({ _id: t.user._id }, { $set: { paused: true } });
      return res.json({ ok: true, message: 'Emails paused. Turn them back on any time from your dashboard.' });
    }
    const status = await markWatched(t.user, t.payload.v);
    res.json({ ok: true, youtube: status, message: `Nice work! It won't be suggested again.${YT_MESSAGE[status]}` });
  });

  // ---------- Connect YouTube (optional, full-page redirects) ----------
  api.get('/auth/google/start', async (req, res) => {
    if (!req.user) return res.redirect(`${config.webUrl}/`);
    if (!googleEnabled()) return webRedirect(res, '/dashboard', 'error', 'YouTube connection is not configured on this server.');
    res.redirect(authUrl(sign({ a: 'g', u: String(req.user._id), exp: Date.now() + 10 * 60_000 })));
  });

  api.get('/auth/google/callback', async (req, res) => {
    if (!req.user) return res.redirect(`${config.webUrl}/`);
    const state = verify(String(req.query.state || ''));
    if (!state || state.a !== 'g' || state.u !== String(req.user._id)) {
      return webRedirect(res, '/dashboard', 'error', 'YouTube connection failed. Please try again.');
    }
    if (req.query.error) return webRedirect(res, '/dashboard', 'error', `YouTube connection cancelled (${req.query.error}).`);
    try {
      const refreshToken = await exchangeCode(String(req.query.code || ''));
      await col.users.updateOne({ _id: req.user._id }, { $set: { googleRefreshToken: refreshToken } });
      webRedirect(res, '/dashboard', 'ok', 'YouTube connected. Videos you mark as watched will go to a private "Watched" playlist.');
    } catch (err) {
      webRedirect(res, '/dashboard', 'error', err.message);
    }
  });

  api.post('/auth/google/disconnect', requireUser, async (req, res) => {
    await col.users.updateOne({ _id: req.user._id }, { $set: { googleRefreshToken: null } });
    res.json({ ok: true, message: 'YouTube disconnected.' });
  });

  // ---------- External cron (for hosts that sleep) ----------
  api.post('/cron', async (req, res) => {
    const given = req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!config.cronSecret || given !== config.cronSecret) return fail(res, 401, 'unauthorized');
    res.json({ results: await tick() });
  });

  app.use('/api', api);
  app.use((_req, res) => fail(res, 404, 'Not found'));
  app.use((err, _req, res, _next) => {
    console.error(err);
    fail(res, err.status && err.status < 500 ? err.status : 500, err.expose ? err.message : 'Something went wrong. Please try again.');
  });

  return app;
}

