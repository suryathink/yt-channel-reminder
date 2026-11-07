import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { dueSlots, formatDuration, localParts, parseSendTimes } from '../src/time.js';
import { parseChannelInput, parseIsoDuration, parseRss } from '../src/youtube.js';
import { sign, verify } from '../src/tokens.js';
import { html, raw } from '../src/html.js';

test('parseSendTimes normalises, sorts and validates', () => {
  assert.deepEqual(parseSendTimes('20:00, 10:00'), ['10:00', '20:00']);
  assert.deepEqual(parseSendTimes('8pm 10am 9:30'), ['09:30', '10:00', '20:00']);
  assert.deepEqual(parseSendTimes('12am,12pm'), ['00:00', '12:00']);
  assert.throws(() => parseSendTimes('25:00'));
  assert.throws(() => parseSendTimes(''));
  assert.throws(() => parseSendTimes('banana'));
});

test('localParts respects the time zone', () => {
  const now = new Date('2026-11-07T04:30:00Z'); // 10:00 in India
  assert.deepEqual(localParts(now, 'Asia/Kolkata'), { date: '2026-11-07', minutes: 600 });
  assert.deepEqual(localParts(now, 'America/Los_Angeles'), { date: '2026-11-06', minutes: 20 * 60 + 30 });
});

test('dueSlots fires at the slot and within the catch-up window only', () => {
  const tz = 'Asia/Kolkata';
  const times = ['10:00', '20:00'];
  assert.deepEqual(dueSlots(new Date('2026-11-07T04:29:00Z'), tz, times, 90), []);
  assert.deepEqual(dueSlots(new Date('2026-11-07T04:30:00Z'), tz, times, 90).map((s) => s.time), ['10:00']);
  assert.deepEqual(dueSlots(new Date('2026-11-07T07:00:00Z'), tz, times, 90), []); // 12:30, too late
  const evening = dueSlots(new Date('2026-11-07T14:30:00Z'), tz, times, 90);
  assert.deepEqual(evening.map((s) => [s.time, s.index, s.date]), [['20:00', 1, '2026-11-07']]);
});

test('parseChannelInput understands common link formats', () => {
  assert.deepEqual(parseChannelInput('https://www.youtube.com/@hnasr'), { type: 'handle', value: 'hnasr' });
  assert.deepEqual(parseChannelInput('https://youtube.com/@hnasr/videos'), { type: 'handle', value: 'hnasr' });
  assert.deepEqual(parseChannelInput('youtube.com/@hnasr'), { type: 'handle', value: 'hnasr' });
  assert.deepEqual(parseChannelInput('@hnasr'), { type: 'handle', value: 'hnasr' });
  assert.deepEqual(parseChannelInput('https://m.youtube.com/channel/UC_ML5xP23TOWKUcc-oAE_Eg'), { type: 'id', value: 'UC_ML5xP23TOWKUcc-oAE_Eg' });
  assert.deepEqual(parseChannelInput('UC_ML5xP23TOWKUcc-oAE_Eg'), { type: 'id', value: 'UC_ML5xP23TOWKUcc-oAE_Eg' });
  assert.deepEqual(parseChannelInput('https://www.youtube.com/user/foo'), { type: 'username', value: 'foo' });
  assert.deepEqual(parseChannelInput('https://www.youtube.com/c/Foo'), { type: 'custom', value: 'Foo' });
  assert.throws(() => parseChannelInput('https://www.youtube.com/watch?v=abc'));
  assert.throws(() => parseChannelInput('https://example.com/@x'));
});

test('parseIsoDuration / formatDuration', () => {
  assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
  assert.equal(parseIsoDuration('PT45S'), 45);
  assert.equal(parseIsoDuration('P0D'), 0);
  assert.equal(formatDuration(3723), '1h 02m');
  assert.equal(formatDuration(1500), '25 min');
});

test('parseRss extracts videos', () => {
  const xml = `<feed><title>Hussein Nasser</title><entry><yt:videoId>abc123</yt:videoId><title>Postgres &amp; you</title>
    <published>2026-01-01T00:00:00+00:00</published><media:thumbnail url="https://i.ytimg.com/x.jpg" width="1"/></entry></feed>`;
  const feed = parseRss(xml);
  assert.equal(feed.title, 'Hussein Nasser');
  assert.deepEqual(feed.videos[0], { videoId: 'abc123', title: 'Postgres & you', publishedAt: '2026-01-01T00:00:00+00:00', thumbnail: 'https://i.ytimg.com/x.jpg', durationSeconds: null });
});

test('signed tokens reject tampering and expiry', () => {
  const t = sign({ a: 'w', u: 1, v: 'abc' });
  assert.deepEqual(verify(t), { a: 'w', u: 1, v: 'abc' });
  const forged = Buffer.from(JSON.stringify({ a: 'w', u: 2, v: 'abc' })).toString('base64url') + '.' + t.split('.')[1];
  assert.equal(verify(forged), null);
  assert.equal(verify(sign({ a: 'g', exp: Date.now() - 1 })), null);
  assert.equal(verify('garbage'), null);
});

test('html escapes interpolations', () => {
  assert.equal(html`<p>${'<script>'}</p>${raw('<b>')}`.toString(), '<p>&lt;script&gt;</p><b>');
});
