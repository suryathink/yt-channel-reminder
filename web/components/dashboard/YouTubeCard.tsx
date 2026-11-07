'use client';

import { api } from '@/lib/api';
import type { ActionResult, Features, User } from '@/lib/types';
import styles from './dashboard.module.scss';

interface Props {
  user: User;
  features: Features;
  run: (fn: () => Promise<ActionResult>) => Promise<void>;
}

export default function YouTubeCard({ user, features, run }: Props) {
  if (!features.youtubeConnect) return null;
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}><h2>YouTube account</h2></div>
      {user.youtubeConnected ? (
        <>
          <p className={styles.status}>● Connected</p>
          <p className="muted">
            Videos you mark as watched are added to a private <strong>&quot;Watched ✓ (YT Reminder)&quot;</strong> playlist on your YouTube account.
          </p>
          <button className="btn btn--secondary" onClick={() => run(() => api<ActionResult>('/auth/google/disconnect', { method: 'POST' }))}>
            Disconnect
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Optional. YouTube doesn&apos;t let apps change your watch history, so when you mark a video as watched,
            we add it to a private &quot;Watched&quot; playlist on your YouTube account instead.
          </p>
          {/* Full-page navigation: the API redirects to Google's consent screen. */}
          <a className="btn btn--secondary" href="/api/auth/google/start">Connect YouTube</a>
        </>
      )}
    </section>
  );
}
