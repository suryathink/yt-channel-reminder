'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import Header from '@/components/Header';
import { api, errorMessage } from '@/lib/api';
import type { ActionResult, LinkInfo } from '@/lib/types';
import styles from './Confirm.module.scss';

/**
 * Landing page for the one-click links in emails ("I've already watched this", "Pause emails").
 * The action needs an explicit click, so link-scanning email security tools can't trigger it.
 */
export default function LinkAction({ token }: { token: string }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<LinkInfo>(`/links/${encodeURIComponent(token)}`).then(setInfo).catch((err) => setError(errorMessage(err)));
  }, [token]);

  async function confirm() {
    setBusy(true);
    try {
      const res = await api<ActionResult>(`/links/${encodeURIComponent(token)}`, { method: 'POST' });
      setDone(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  let body: React.ReactNode;
  if (error) {
    body = <><h1>Link not valid</h1><p>{error}</p></>;
  } else if (!info) {
    body = <p>Loading…</p>;
  } else if (done) {
    body = info.action === 'watched'
      ? <><h1>Marked as watched ✓</h1><p>{done} Don&apos;t forget to write your notes in Notion. 📝</p></>
      : <><h1>Emails paused</h1><p>{done}</p></>;
  } else if (info.action === 'watched') {
    body = (
      <>
        <h1>{info.alreadyWatched ? 'Already marked as watched' : 'Mark this video as watched?'}</h1>
        <div className={styles.video}>
          {info.video.thumbnail && <img src={info.video.thumbnail} alt="" />}
          <strong>{info.video.title}</strong>
        </div>
        <p>It won&apos;t be suggested to you again.</p>
        <div className={styles.actions}>
          <button className="btn" onClick={confirm} disabled={busy || info.alreadyWatched}>✓ Yes, I&apos;ve watched it</button>
          <a className="btn btn--secondary" href={info.video.url} target="_blank" rel="noopener noreferrer">Open on YouTube</a>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <h1>Pause reminder emails?</h1>
        <p>You&apos;ll stop getting reminders at {info.email}. You can turn them back on from your dashboard.</p>
        <div className={styles.actions}>
          <button className="btn" onClick={confirm} disabled={busy || info.paused}>{info.paused ? 'Already paused' : 'Pause emails'}</button>
        </div>
      </>
    );
  }

  return (
    <main className="container">
      <Header />
      <div className={styles.box}>
        {body}
        {(done || error) && <p style={{ marginTop: 24, marginBottom: 0 }}><Link href="/dashboard">Go to your dashboard →</Link></p>}
      </div>
    </main>
  );
}
