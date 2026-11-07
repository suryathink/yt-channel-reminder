'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import styles from './Header.module.scss';

export default function Header({ email }: { email?: string }) {
  const router = useRouter();

  async function signOut() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    router.replace('/');
  }

  return (
    <header className={styles.header}>
      <Link href={email ? '/dashboard' : '/'} className={styles.brand}>
        <span className={styles.logo} aria-hidden>▶</span> YT Reminder
      </Link>
      {email && (
        <div className={styles.account}>
          <span className={styles.email}>{email}</span>
          <button className="btn btn--ghost" onClick={signOut}>Sign out</button>
        </div>
      )}
    </header>
  );
}
