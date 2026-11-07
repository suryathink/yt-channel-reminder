import styles from './Notice.module.scss';

export type NoticeState = { kind: 'ok' | 'error'; text: string } | null;

export default function Notice({ notice, onClose }: { notice: NoticeState; onClose?: () => void }) {
  if (!notice) return null;
  return (
    <div className={`${styles.notice} ${notice.kind === 'error' ? styles.error : ''}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      {onClose && <button className={styles.close} onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}
