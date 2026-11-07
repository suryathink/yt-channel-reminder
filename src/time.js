export function isValidTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date (YYYY-MM-DD) and minutes since local midnight for `date` in `tz`. */
export function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Parses "10:00, 8pm, 20:30" into sorted unique ["10:00","20:00","20:30"]. Throws on bad input. */
export function parseSendTimes(input) {
  const parts = String(input).split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Add at least one send time.');
  const out = new Set();
  for (const part of parts) {
    const m = part.toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!m) throw new Error(`"${part}" is not a valid time. Use 24h HH:MM, e.g. 10:00 or 20:00.`);
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    if (m[3]) {
      if (h < 1 || h > 12) throw new Error(`"${part}" is not a valid time.`);
      h = (h % 12) + (m[3] === 'pm' ? 12 : 0);
    }
    if (h > 23 || min > 59) throw new Error(`"${part}" is not a valid time.`);
    out.add(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  }
  if (out.size > 6) throw new Error('At most 6 emails per day.');
  return [...out].sort();
}

/** Which of `times` are due right now (reached, and not more than `catchup` minutes ago). */
export function dueSlots(now, tz, times, catchup) {
  const { date, minutes } = localParts(now, tz);
  return times
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => minutes >= toMinutes(time) && minutes - toMinutes(time) <= catchup)
    .map((s) => ({ ...s, date }));
}

export function formatDuration(seconds) {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}
