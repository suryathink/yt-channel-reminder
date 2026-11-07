'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import { api, errorMessage } from '@/lib/api';
import styles from '@/components/Confirm.module.scss';

function Verify() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [error, setError] = useState<string | null>(token ? null : 'This sign-in link is missing its token.');
  const [busy, setBusy] = useState(false);

  // Sign-in needs a click: email security scanners open links automatically, and that must not use up the token.
  async function signIn() {
    setBusy(true);
    try {
      await api('/auth/verify', { method: 'POST', body: { token } });
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.box}>
      {error ? (
        <>
          <h1>Couldn&apos;t sign you in</h1>
          <p>{error}</p>
          <Link className="btn" href="/">Get a new link</Link>
        </>
      ) : (
        <>
          <h1>Welcome back 👋</h1>
          <p>Click below to finish signing in.</p>
          <button className="btn" onClick={signIn} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <main className="container">
      <Header />
      <Suspense><Verify /></Suspense>
    </main>
  );
}
