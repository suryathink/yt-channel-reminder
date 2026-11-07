'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { percent } from '@/lib/format';
import type { ActionResult, Features, TodayItem } from '@/lib/types';
import styles from './dashboard.module.scss';

interface Props {
  items: TodayItem[];
  features: Features;
  run: (fn: () => Promise<ActionResult>) => Promise<void>;
}

export default function ChannelsCard({ items, features, run }: Props) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<ActionResult>) {
    setBusy(key);
    await run(fn);
    setBusy(null);
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    await act('add', async () => {
      const res = await api<ActionResult>('/channels', { method: 'POST', body: { channel: link } });
      setLink('');
      return res;
    });
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>Your channels</h2></div>

      {items.length ? (
        <ul className={styles.channels}>
          {items.map(({ channel, progress }) => {
            const pct = percent(progress.watched, progress.total);
            return (
              <li key={channel.id} className={styles.channel}>
                {channel.thumbnail
                  ? <img className={styles.avatar} src={channel.thumbnail} alt="" />
                  : <span className={styles.avatar} aria-hidden>{channel.title.slice(0, 1)}</span>}
                <div className={styles.channelInfo}>
                  <a href={`https://www.youtube.com/channel/${channel.id}`} target="_blank" rel="noopener noreferrer">{channel.title}</a>
                  <div className="small muted">{progress.watched} of {progress.total} videos watched ({pct}%)</div>
                  <div className={styles.bar}><span style={{ width: `${pct}%` }} /></div>
                </div>
                <div className={styles.channelActions}>
                  <button className="btn btn--ghost small" disabled={busy === `sync:${channel.id}`}
                    onClick={() => act(`sync:${channel.id}`, () => api(`/channels/${channel.id}/sync`, { method: 'POST' }))}>
                    {busy === `sync:${channel.id}` ? 'Checking…' : 'Refresh'}
                  </button>
                  <button className="btn btn--ghost small" disabled={busy === `del:${channel.id}`}
                    onClick={() => confirm(`Stop getting videos from ${channel.title}?`)
                      && act(`del:${channel.id}`, () => api(`/channels/${channel.id}`, { method: 'DELETE' }))}>
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>No channels yet. Add your first one below to start getting daily videos.</p>
      )}

      <form className={styles.addForm} onSubmit={add}>
        <input className="input" required placeholder="https://www.youtube.com/@hnasr" value={link}
          onChange={(e) => setLink(e.target.value)} aria-label="YouTube channel link" />
        <button className="btn" disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : 'Add channel'}</button>
      </form>
      <p className="hint">
        Paste a channel link, an @handle, or a channel ID. Big channels can take a few seconds to import.
        {!features.fullChannelHistory && ' This server only has access to each channel\'s latest 15 videos.'}
      </p>
    </section>
  );
}
