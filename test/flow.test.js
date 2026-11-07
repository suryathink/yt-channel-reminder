import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/db.js';
import { setTransport } from '../src/email.js';
import { channelProgress, getOrCreatePick, markWatched } from '../src/picker.js';
import { tick } from '../src/reminders.js';
import { saveVideos, upsertChannel } from '../src/youtube.js';
import { verify } from '../src/tokens.js';
import { createApp } from '../src/server.js';

const sent = [];
setTransport(async (m) => { sent.push(m); return { id: 'x' }; });

const CH = 'UC_ML5xP23TOWKUcc-oAE_Eg';
upsertChannel({ channelId: CH, title: 'Hussein Nasser', handle: '@hnasr', thumbnail: null });
db.prepare('UPDATE channels SET last_synced_at = ? WHERE channel_id = ?').run(new Date('2100-01-01').toISOString(), CH);
saveVideos(CH, [
  { videoId: 'v1', title: 'How Postgres stores data', publishedAt: null, thumbnail: null, durationSeconds: 3600 },
  { videoId: 'v2', title: 'TCP explained', publishedAt: null, thumbnail: null, durationSeconds: 2400 },
  { videoId: 'v3', title: 'A short', publishedAt: null, thumbnail: null, durationSeconds: 40 },
]);
db.prepare(`INSERT INTO users (email, timezone, send_times, created_at) VALUES ('me@example.com', 'Asia/Kolkata', '10:00,20:00', ?)`).run(new Date().toISOString());
const user = db.prepare('SELECT * FROM users').get();
db.prepare('INSERT INTO subscriptions VALUES (?, ?, ?)').run(user.id, CH, new Date().toISOString());

test('picker keeps the same video all day, skips shorts and watched videos', async () => {
  const a = getOrCreatePick(user.id, CH, '2026-11-01', () => 0);
  assert.ok(['v1', 'v2'].includes(a.video_id));
  assert.equal(getOrCreatePick(user.id, CH, '2026-11-01', () => 0.99).video_id, a.video_id);
  await markWatched(user, a.video_id);
  const b = getOrCreatePick(user.id, CH, '2026-11-01');
  assert.notEqual(b.video_id, a.video_id);
  assert.notEqual(b.video_id, 'v3');
  assert.deepEqual({ ...channelProgress(user.id, CH) }, { total: 2, watched: 1 });
  await markWatched(user, b.video_id);
  assert.equal(getOrCreatePick(user.id, CH, '2026-11-02'), null);
  db.prepare('DELETE FROM watched').run();
  db.prepare('DELETE FROM daily_picks').run();
});

test('scheduler sends at 10:00 and 20:00 local time, once each', async () => {
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
  // Same video in the evening reminder
  const title = (s) => s.subject.match(/(How Postgres stores data|TCP explained)/)[1];
  assert.equal(title(sent[1]), title(sent[0]));
});

test('watched link from the email marks the video and the next pick differs', async () => {
  const app = createApp();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const link = sent[0].html.match(/https:\/\/app\.example\.com(\/w\/[^"]+)/)[1];
    const { v } = verify(link.slice(3));
    const page = await fetch(base + link);
    assert.equal(page.status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM watched').get().n, 0, 'GET must not mark (link scanners)');
    const done = await fetch(base + link, { method: 'POST' });
    assert.match(await done.text(), /Marked as watched/);
    assert.equal(db.prepare('SELECT video_id FROM watched').get().video_id, v);
    assert.notEqual(getOrCreatePick(user.id, CH, '2026-11-07').video_id, v);

    const bad = await fetch(`${base}/w/forged.token`, { method: 'POST' });
    assert.equal(bad.status, 400);
    const cron = await fetch(`${base}/cron`);
    assert.equal(cron.status, 401);
  } finally {
    server.close();
  }
});

test('magic link login creates an account and shows the dashboard', async () => {
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    sent.length = 0;
    await fetch(`${base}/login`, { method: 'POST', body: new URLSearchParams({ email: 'New@Example.com' }) });
    const link = sent[0].text.match(/https:\/\/app\.example\.com(\/auth\/verify\?token=\S+)/)[1];
    const res = await fetch(base + link, { method: 'POST', redirect: 'manual' });
    assert.equal(res.status, 302);
    const cookie = res.headers.get('set-cookie').split(';')[0];
    const dash = await fetch(`${base}/dashboard`, { headers: { cookie } });
    const body = await dash.text();
    assert.match(body, /new@example\.com/);
    assert.match(body, /Add your first one/);
    assert.equal(await fetch(base + link, { method: 'POST', redirect: 'manual' }).then((r) => r.status), 400, 'token is single-use');
  } finally {
    server.close();
  }
});
