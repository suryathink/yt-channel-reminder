'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { formatDuration } from '@/lib/format';
import type { ActionResult, TodayItem } from '@/lib/types';
import styles from './dashboard.module.scss';

interface Props {
  today: TodayItem[];
  notionUrl: string;
  run: (fn: () => Promise<ActionResult>) => Promise<void>;
}

export default function TodayCard({ today, notionUrl, run }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!today.length) return null;

  async function markWatched(videoId: string) {
    setBusy(videoId);
    await run(() => api<ActionResult>(`/videos/${encodeURIComponent(videoId)}/watched`, { method: 'POST' }));
    setBusy(null);
  }

  const withVideo = today.filter((i) => i.video);

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>Today&apos;s video{withVideo.length > 1 ? 's' : ''}</h2></div>

      {today.map(({ channel, video, progress }) => video ? (
        <article key={channel.id} className={styles.video}>
          <a className={styles.thumb} href={video.url} target="_blank" rel="noopener noreferrer">
            {video.thumbnail && <img src={video.thumbnail} alt="" />}
            {video.durationSeconds ? <span className={styles.duration}>{formatDuration(video.durationSeconds)}</span> : null}
          </a>
          <div>
            <div className={styles.meta}>{channel.title} · {progress.watched} of {progress.total} watched</div>
            <h3 className={styles.title}>{video.title}</h3>
            <div className={styles.actions}>
              <a className="btn" href={video.url} target="_blank" rel="noopener noreferrer">▶ Watch on YouTube</a>
              <button className="btn btn--secondary" disabled={busy === video.id} onClick={() => markWatched(video.id)}>
                ✓ Mark as watched
              </button>
            </div>
          </div>
        </article>
      ) : (
        <div key={channel.id} className={styles.done}>
          <strong>{channel.title}</strong>{' '}
          <span className="muted">
            {progress.total ? `· you've watched all ${progress.total} videos 🎉` : '· no videos found yet. Try Refresh below.'}
          </span>
        </div>
      ))}

      {withVideo.length > 0 && (
        <div className={styles.note}>
          📝 <strong>After watching, take notes.</strong>{' '}
          {notionUrl
            ? <>Write them up in <a href={notionUrl} target="_blank" rel="noopener noreferrer">your Notion page</a>: </>
            : <>Create a note in Notion: </>}
          the key concepts, how it works under the hood, the trade-offs, and one thing to try yourself.
        </div>
      )}
    </section>
  );
}
