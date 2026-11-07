export function formatDuration(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m} min`;
}

export const percent = (watched: number, total: number) => (total ? Math.round((watched / total) * 100) : 0);

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "20:00" -> "8:00 PM" in the viewer's locale. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function allTimezones(current?: string): string[] {
  const list: string[] = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  // ICU lists some zones under old names (e.g. Asia/Calcutta), so make sure the saved one is present.
  return current && !list.includes(current) ? [current, ...list] : list;
}
