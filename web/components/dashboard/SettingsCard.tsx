'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { allTimezones, formatTime } from '@/lib/format';
import type { ActionResult, User } from '@/lib/types';
import styles from './dashboard.module.scss';

interface Props {
  user: User;
  run: (fn: () => Promise<ActionResult>) => Promise<void>;
}

export default function SettingsCard({ user, run }: Props) {
  const [timezone, setTimezone] = useState(user.timezone);
  const [times, setTimes] = useState<string[]>(user.sendTimes);
  const [notionUrl, setNotionUrl] = useState(user.notionUrl);
  const [paused, setPaused] = useState(user.paused);
  const [busy, setBusy] = useState<'save' | 'send' | null>(null);
  const zones = useMemo(() => allTimezones(timezone), [timezone]);
  const browserZone = typeof window !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';

  const setTime = (i: number, value: string) => setTimes((t) => t.map((x, j) => (j === i ? value : x)));
  const removeTime = (i: number) => setTimes((t) => t.filter((_, j) => j !== i));
  const addTime = () => setTimes((t) => [...t, '12:00']);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy('save');
    await run(async () => {
      await api('/settings', { method: 'PATCH', body: { timezone, sendTimes: times.filter(Boolean), notionUrl, paused } });
      return { ok: true, message: 'Settings saved.' };
    });
    setBusy(null);
  }

  async function sendNow() {
    setBusy('send');
    await run(() => api<ActionResult>('/send-now', { method: 'POST' }));
    setBusy(null);
  }

  const sorted = [...times].filter(Boolean).sort();

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>Email settings</h2></div>
      <form onSubmit={save}>
        <label className="label" style={{ marginTop: 0 }}>Send times</label>
        <div className={styles.times}>
          {times.map((t, i) => (
            <span key={i} className={styles.time}>
              <input type="time" value={t} required onChange={(e) => setTime(i, e.target.value)} aria-label={`Send time ${i + 1}`} />
              {times.length > 1 && <button type="button" className={styles.remove} onClick={() => removeTime(i)} aria-label="Remove time">×</button>}
            </span>
          ))}
          {times.length < 6 && <button type="button" className="btn btn--secondary" onClick={addTime}>+ Add time</button>}
        </div>
        <p className="hint">
          {sorted.length > 0 && <>At {formatTime(sorted[0])} you get a new video. </>}
          {sorted.length > 1 && <>Later emails remind you about the same video, or pick a new one if you&apos;ve already watched it.</>}
        </p>

        <label className="label" htmlFor="tz">Time zone</label>
        <div className={styles.tzRow}>
          <select id="tz" className="select" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
          {browserZone && browserZone !== timezone && (
            <button type="button" className="btn btn--secondary" onClick={() => setTimezone(browserZone)}>
              Use {browserZone.replace(/_/g, ' ')}
            </button>
          )}
        </div>

        <label className="label" htmlFor="notion">Notion notes page <span className="muted small">(optional)</span></label>
        <input id="notion" className="input" type="url" placeholder="https://www.notion.so/My-learning-notes-…"
          value={notionUrl} onChange={(e) => setNotionUrl(e.target.value)} />
        <p className="hint">Linked in every email so you can write your notes right after watching.</p>

        <label className={styles.check}>
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Pause all emails
        </label>

        <div className={styles.formActions}>
          <button className="btn" disabled={busy !== null}>{busy === 'save' ? 'Saving…' : 'Save settings'}</button>
          <button type="button" className="btn btn--secondary" disabled={busy !== null} onClick={sendNow}>
            {busy === 'send' ? 'Sending…' : 'Send me today\'s email now'}
          </button>
        </div>
        <p className="hint">Emails go to <strong>{user.email}</strong>.</p>
      </form>
    </section>
  );
}
