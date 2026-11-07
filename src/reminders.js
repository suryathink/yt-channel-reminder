import { config } from './config.js';
import { db } from './db.js';
import { sendEmail } from './email.js';
import { renderDailyEmail } from './emailTemplates.js';
import { channelProgress, getOrCreatePick } from './picker.js';
import { dueSlots, localParts, parseSendTimes } from './time.js';
import { refreshStaleChannels } from './youtube.js';

export const userChannels = (userId) => db.prepare(`SELECT c.* FROM subscriptions s
  JOIN channels c ON c.channel_id = s.channel_id WHERE s.user_id = ? ORDER BY c.title COLLATE NOCASE`).all(userId);

/** Builds and sends the reminder email for one user. Returns { sent, subject }. */
export async function sendDailyEmail(user, { localDate, slotIndex }) {
  const channels = userChannels(user.id);
  if (!channels.length) return { sent: false, reason: 'no channels' };
  const items = channels.map((channel) => ({
    channel,
    video: getOrCreatePick(user.id, channel.channel_id, localDate),
    progress: channelProgress(user.id, channel.channel_id),
  }));
  if (!items.some((i) => i.progress.total)) return { sent: false, reason: 'no videos synced yet' };
  const email = renderDailyEmail({ user, items, slotIndex });
  await sendEmail({ to: user.email, subject: email.subject, html: email.html, text: email.text });
  return { sent: true, subject: email.subject };
}

/** Send the current email right now (the "send me a test email" button). */
export function sendNow(user, now = new Date()) {
  const { date } = localParts(now, user.timezone);
  const times = parseSendTimes(user.send_times);
  const due = dueSlots(now, user.timezone, times, 24 * 60);
  return sendDailyEmail(user, { localDate: date, slotIndex: due.length ? due.at(-1).index : 0 });
}

let running = false;

/** Runs once a minute. Sends every email that is due and hasn't been sent yet. */
export async function tick(now = new Date()) {
  if (running) return [];
  running = true;
  const results = [];
  try {
    await refreshStaleChannels();
    const users = db.prepare(`SELECT * FROM users WHERE paused = 0
      AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = users.id)`).all();
    for (const user of users) {
      let times;
      try { times = parseSendTimes(user.send_times); } catch { continue; }
      for (const slot of dueSlots(now, user.timezone, times, config.catchupMinutes)) {
        // Claim the slot first so overlapping runs / multiple instances never double-send.
        const claim = db.prepare('INSERT OR IGNORE INTO sends (user_id, local_date, slot, sent_at) VALUES (?, ?, ?, ?)')
          .run(user.id, slot.date, slot.time, now.toISOString());
        if (!claim.changes) continue;
        try {
          const r = await sendDailyEmail(user, { localDate: slot.date, slotIndex: slot.index });
          results.push({ userId: user.id, slot: slot.time, ...r });
          if (r.sent) console.log(`[send] user ${user.id} ${slot.date} ${slot.time}: ${r.subject}`);
        } catch (err) {
          console.error(`[send] user ${user.id} ${slot.time} failed:`, err.message);
          // Release the claim so the next tick retries (within the catch-up window).
          db.prepare('DELETE FROM sends WHERE user_id = ? AND local_date = ? AND slot = ?').run(user.id, slot.date, slot.time);
          results.push({ userId: user.id, slot: slot.time, sent: false, error: err.message });
        }
      }
    }
  } finally {
    running = false;
  }
  return results;
}

export function startScheduler() {
  const run = () => tick().catch((err) => console.error('[scheduler]', err));
  // Align to the start of each minute.
  setTimeout(() => { run(); setInterval(run, 60_000); }, 60_000 - (Date.now() % 60_000) + 1000);
  run();
}
