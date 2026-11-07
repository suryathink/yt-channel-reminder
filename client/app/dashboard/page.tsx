'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import Notice, { type NoticeState } from '@/components/Notice';
import ChannelsCard from '@/components/dashboard/ChannelsCard';
import HistoryCard from '@/components/dashboard/HistoryCard';
import SettingsCard from '@/components/dashboard/SettingsCard';
import TodayCard from '@/components/dashboard/TodayCard';
import YouTubeCard from '@/components/dashboard/YouTubeCard';
import styles from '@/components/dashboard/dashboard.module.scss';
import { ApiError, api, errorMessage } from '@/lib/api';
import type { ActionResult, DashboardData } from '@/lib/types';

function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [data, setData] = useState<DashboardData | null>(null);
  const [notice, setNotice] = useState<NoticeState>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<DashboardData>('/dashboard'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/');
      else setNotice({ kind: 'error', text: errorMessage(err) });
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  // Messages passed back in the URL (e.g. after connecting YouTube).
  useEffect(() => {
    const ok = params.get('ok');
    const error = params.get('error');
    if (ok || error) {
      setNotice(error ? { kind: 'error', text: error } : { kind: 'ok', text: ok! });
      router.replace('/dashboard');
    }
  }, [params, router]);

  /** Runs an action, shows its message, and reloads the dashboard. */
  const run = useCallback(async (fn: () => Promise<ActionResult>) => {
    try {
      const res = await fn();
      setNotice({ kind: 'ok', text: res.message });
      await load();
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    }
  }, [load]);

  return (
    <main className="container">
      <Header email={data?.user.email} />
      <Notice notice={notice} onClose={() => setNotice(null)} />
      {!data ? (
        <div className={styles.grid}><div className={styles.loading} /><div className={styles.loading} /></div>
      ) : (
        <div className={styles.grid}>
          <TodayCard today={data.today} notionUrl={data.user.notionUrl} run={run} />
          <ChannelsCard items={data.today} features={data.features} run={run} />
          {/* key: reset the form to saved values after each reload */}
          <SettingsCard key={JSON.stringify(data.user)} user={data.user} run={run} />
          <YouTubeCard user={data.user} features={data.features} run={run} />
          <HistoryCard recent={data.recent} run={run} />
        </div>
      )}
    </main>
  );
}

export default function DashboardPage() {
  return <Suspense><Dashboard /></Suspense>;
}
