'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from '@/components/Header';
import Notice, { type NoticeState } from '@/components/Notice';
import { api, errorMessage } from '@/lib/api';
import styles from './page.module.scss';

const STEPS = [
  { title: 'Add channels', text: 'Paste a channel link, like Hussein Nasser\'s backend engineering channel. Add as many as you like.' },
  { title: 'Get a daily video', text: 'Every morning you get one random video you haven\'t watched, and a reminder in the evening. You choose the times.' },
  { title: 'Watch, take notes, mark it done', text: 'One click marks it watched so it never comes back. Write your notes in Notion while it\'s fresh.' },
];

export default function Home() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);

  // Already signed in? Go straight to the dashboard.
  useEffect(() => {
    api('/me').then(() => router.replace('/dashboard')).catch(() => {});
  }, [router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ email: string }>('/auth/login', { method: 'POST', body: { email } });
      setSentTo(res.email);
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <Header />
      <section className={styles.hero}>
        <h1>Actually watch the channels you <span className={styles.accent}>learn from</span>.</h1>
        <p>
          Pick the YouTube channels you keep meaning to watch. Every day you get one video you haven&apos;t seen yet,
          by email, at the times you choose. One click marks it as watched.
        </p>
      </section>

      <section className={styles.login}>
        {sentTo ? (
          <div className={styles.sent}>
            <h2>Check your inbox 📬</h2>
            <p>We sent a sign-in link to <strong>{sentTo}</strong>. It expires in 15 minutes.</p>
            <button className="btn btn--secondary" onClick={() => setSentTo(null)}>Use a different email</button>
          </div>
        ) : (
          <>
            <h2>Sign in or create an account</h2>
            <Notice notice={notice} />
            <form className={styles.form} onSubmit={submit}>
              <input className="input" type="email" required placeholder="you@example.com" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email address" />
              <button className="btn" disabled={busy}>{busy ? 'Sending…' : 'Email me a sign-in link'}</button>
            </form>
            <p className="hint">No password needed. Your reminders are sent to this address.</p>
          </>
        )}
      </section>

      <section className={styles.steps}>
        {STEPS.map((s, i) => (
          <div key={s.title} className={styles.step}>
            <div className={styles.num}>{i + 1}</div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
