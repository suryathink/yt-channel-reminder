'use client';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { ActionResult, RecentItem } from '@/lib/types';
import styles from './dashboard.module.scss';

interface Props {
  recent: RecentItem[];
  run: (fn: () => Promise<ActionResult>) => Promise<void>;
}

export default function HistoryCard({ recent, run }: Props) {
  if (!recent.length) return null;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>Recently watched</h2></div>
      <ul className={styles.history}>
        {recent.map((r) => (
          <li key={r.videoId}>
            <a href={r.url} target="_blank" rel="noopener noreferrer" title={r.title}>{r.title}</a>
            <span className="small muted" style={{ whiteSpace: 'nowrap' }}>
              {formatDate(r.watchedAt)}
              <button className="btn btn--ghost small"
                onClick={() => run(() => api<ActionResult>(`/videos/${encodeURIComponent(r.videoId)}/watched`, { method: 'DELETE' }))}>
                Undo
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
