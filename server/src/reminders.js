import { config } from './config.js';
import { col, isDuplicateKey } from './db.js';
import { sendEmail } from './email.js';
import { renderDailyEmail } from './emailTemplates.js';
import { channelProgress, getOrCreatePick } from './picker.js';
import { dueSlots, localParts } from './time.js';
import { refreshStaleChannels } from './youtube.js';

export async function userChannels(userId) {
  const subs = await col.subscriptions.find({ userId }).toArray();
  const channels = await col.channels.find({ _id: { $in: subs.map((s) => s.channelId) } }).toArray();
  return channels.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/** Today's video + progress for each of the user's channels. */
export async function todayItems(user, localDate) {
  const channels = await userChannels(user._id);
  return Promise.all(channels.map(async (channel) => ({
    channel,
    video: await getOrCreatePick(user._id, channel._id, localDate),
    progress: await channelProgress(user._id, channel._id),
  })));
}

/** Builds and sends the reminder email for one user. Returns { sent, subject | reason }. */
export async function sendDailyEmail(user, { localDate, slotIndex }) {
  const items = await todayItems(user, localDate);
  if (!items.length) return { sent: false, reason: 'no channels' };
  if (!items.some((i) => i.progress.total)) return { sent: false, reason: 'no videos synced yet' };
  const email = renderDailyEmail({ user, items, slotIndex });
  await sendEmail({ to: user.email, subject: email.subject, html: email.html, text: email.text });
  return { sent: true, subject: email.subject };
}

/** Send the current email right now (the "send me today's email" button). */
export function sendNow(user, now = new Date()) {
  const { date } = localParts(now, user.timezone);
  const due = dueSlots(now, user.timezone, user.sendTimes, 24 * 60);
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
    const subscribedUserIds = await col.subscriptions.distinct('userId');
    const users = await col.users.find({ _id: { $in: subscribedUserIds }, paused: { $ne: true } }).toArray();
    for (const user of users) {
      for (const slot of dueSlots(now, user.timezone, user.sendTimes || [], config.catchupMinutes)) {
        // Claim the slot first (unique index) so overlapping runs / several instances never double-send.
        const key = { userId: user._id, localDate: slot.date, slot: slot.time };
        try {
          await col.sends.insertOne({ ...key, sentAt: now });
        } catch (err) {
          if (isDuplicateKey(err)) continue;
          throw err;
        }
        try {
          const r = await sendDailyEmail(user, { localDate: slot.date, slotIndex: slot.index });
          results.push({ userId: String(user._id), slot: slot.time, ...r });
          if (r.sent) console.log(`[send] ${user.email} ${slot.date} ${slot.time}: ${r.subject}`);
        } catch (err) {
          console.error(`[send] ${user.email} ${slot.time} failed:`, err.message);
          // Release the claim so the next tick retries (within the catch-up window).
          await col.sends.deleteOne(key);
          results.push({ userId: String(user._id), slot: slot.time, sent: false, error: err.message });
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
