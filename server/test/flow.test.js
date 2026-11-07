import './setup.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { col } from '../src/db.js';
import { setTransport } from '../src/email.js';
import { channelProgress, getOrCreatePick, markWatched } from '../src/picker.js';
import { tick } from '../src/reminders.js';
import { saveVideos, upsertChannel } from '../src/youtube.js';
import { verify } from '../src/tokens.js';
import { createApp } from '../src/server.js';
import { startTestDb, stopTestDb } from './mongo.js';

const skip = await startTestDb();
if (skip) console.warn(`# SKIPPING database tests: ${skip}`);
const dbTest = (name, fn) => test(name, { skip: skip || false }, fn);

const sent = [];
setTransport(async (m) => { sent.push(m); return { id: 'x' }; });

const CH = 'UC_ML5xP23TOWKUcc-oAE_Eg';
let user;
let server;
let base;

before(async () => {
  if (skip) return;
  await upsertChannel({ channelId: CH, title: 'Hussein Nasser', handle: '@hnasr', thumbnail: null });
  await col.channels.updateOne({ _id: CH }, { $set: { lastSyncedAt: new Date('2100-01-01') } });
  await saveVideos(CH, [
    { videoId: 'v1', title: 'How Postgres stores data', publishedAt: null, thumbnail: null, durationSeconds: 3600 },
    { videoId: 'v2', title: 'TCP explained', publishedAt: null, thumbnail: null, durationSeconds: 2400 },
    { videoId: 'v3', title: 'A short', publishedAt: null, thumbnail: null, durationSeconds: 40 },
  ]);
  const { insertedId } = await col.users.insertOne({
    email: 'me@example.com', timezone: 'Asia/Kolkata', sendTimes: ['10:00', '20:00'], paused: false, createdAt: new Date(),
  });
  user = await col.users.findOne({ _id: insertedId });
  await col.subscriptions.insertOne({ userId: user._id, channelId: CH, createdAt: new Date() });
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  server?.close();
  if (!skip) await stopTestDb(col.users.db);
});

dbTest('picker keeps the same video all day, skips shorts and watched videos', async () => {
  const a = await getOrCreatePick(user._id, CH, '2026-11-01', () => 0);
  assert.ok(['v1', 'v2'].includes(a._id));
  assert.equal((await getOrCreatePick(user._id, CH, '2026-11-01', () => 0.99))._id, a._id);
  await markWatched(user, a._id);
  const b = await getOrCreatePick(user._id, CH, '2026-11-01');
  assert.notEqual(b._id, a._id);
  assert.notEqual(b._id, 'v3');
  assert.deepEqual(await channelProgress(user._id, CH), { total: 2, watched: 1 });
  await markWatched(user, b._id);
  assert.equal(await getOrCreatePick(user._id, CH, '2026-11-02'), null);
  await col.watched.deleteMany({});
  await col.dailyPicks.deleteMany({});
});

dbTest('scheduler sends at 10:00 and 20:00 local time, once each', async () => {
  sent.length = 0;
  await tick(new Date('2026-11-07T04:29:00Z')); // 09:59 IST
  assert.equal(sent.length, 0);
  await tick(new Date('2026-11-07T04:30:00Z')); // 10:00 IST
  await tick(new Date('2026-11-07T04:31:00Z'));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'me@example.com');
  assert.match(sent[0].subject, /^📺 Today's video: /);
  assert.match(sent[0].html, /Notion/);
  assert.match(sent[0].html, /I&#39;ve already watched this/);
  assert.doesNotMatch(sent[0].html, /A short/);

  await tick(new Date('2026-11-07T14:30:00Z')); // 20:00 IST
  assert.equal(sent.length, 2);
  assert.match(sent[1].subject, /^⏰ Reminder/);
  const title = (s) => s.subject.match(/(How Postgres stores data|TCP explained)/)[1];
  assert.equal(title(sent[1]), title(sent[0]), 'evening reminder repeats the morning video');
});

dbTest('watched link from the email: GET describes, POST marks', async () => {
  const token = sent[0].html.match(/https:\/\/app\.example\.com\/w\/([^"]+)/)[1];
  const { v } = verify(token);
  const info = await fetch(`${base}/links/${token}`).then((r) => r.json());
  assert.equal(info.action, 'watched');
  assert.equal(info.video.id, v);
  assert.equal(await col.watched.countDocuments(), 0, 'GET must not mark (link scanners)');
  const done = await fetch(`${base}/links/${token}`, { method: 'POST' }).then((r) => r.json());
  assert.equal(done.ok, true);
  assert.equal((await col.watched.findOne()).videoId, v);
  assert.notEqual((await getOrCreatePick(user._id, CH, '2026-11-07'))._id, v);

  assert.equal((await fetch(`${base}/links/forged.token`, { method: 'POST' })).status, 400);
  assert.equal((await fetch(`${base}/cron`, { method: 'POST' })).status, 401);
});

dbTest('magic-link login, dashboard, settings and channels API', async () => {
  sent.length = 0;
  const json = { 'Content-Type': 'application/json' };
  await fetch(`${base}/auth/login`, { method: 'POST', headers: json, body: JSON.stringify({ email: 'New@Example.com' }) });
  const token = decodeURIComponent(sent[0].text.match(/\/auth\/verify\?token=(\S+)/)[1]);
  const res = await fetch(`${base}/auth/verify`, { method: 'POST', headers: json, body: JSON.stringify({ token }) });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const again = await fetch(`${base}/auth/verify`, { method: 'POST', headers: json, body: JSON.stringify({ token }) });
  assert.equal(again.status, 400, 'login token is single-use');

  assert.equal((await fetch(`${base}/dashboard`)).status, 401);
  const dash = await fetch(`${base}/dashboard`, { headers: { cookie } }).then((r) => r.json());
  assert.equal(dash.user.email, 'new@example.com');
  assert.deepEqual(dash.user.sendTimes, ['10:00', '20:00']);
  assert.deepEqual(dash.today, []);

  const auth = { ...json, cookie };
  const bad = await fetch(`${base}/settings`, { method: 'PATCH', headers: auth, body: JSON.stringify({ sendTimes: ['25:00'] }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(`${base}/settings`, {
    method: 'PATCH', headers: auth, body: JSON.stringify({ sendTimes: ['8pm', '07:30'], timezone: 'Europe/London', paused: true }),
  }).then((r) => r.json());
  assert.deepEqual(ok.user.sendTimes, ['07:30', '20:00']);
  assert.equal(ok.user.timezone, 'Europe/London');
  assert.equal(ok.user.paused, true);

  const add = await fetch(`${base}/channels`, { method: 'POST', headers: auth, body: JSON.stringify({ channel: 'https://example.com/x' }) });
  assert.equal(add.status, 400);
});
