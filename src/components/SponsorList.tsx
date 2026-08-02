import { useCallback, useEffect, useState } from 'react';
import { getSponsors, type SponsorEntry } from '../lib/paymentClient';
import { formatTime } from '../lib/formatTime';
import { SectionHeader } from './SectionHeader';

interface SponsorListProps {
  open: boolean;
  onClose: () => void;
}

export function SponsorList({ open, onClose }: SponsorListProps) {
  const [rows, setRows] = useState<SponsorEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await getSponsors());
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法获取赞助名单');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSponsors()
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : '无法获取赞助名单'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="赞助名单"
    >
      <div
        className="glass flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 pt-6">
          <SectionHeader
            title="赞助名单"
            action={
              <button type="button" onClick={onClose} className="glass-btn px-3 py-1.5 font-mono text-xs text-zzz-text">
                关闭
              </button>
            }
          />
        </div>
        <div className="overflow-y-auto px-6 pb-6">
          {loading && <p className="font-mono text-xs text-zzz-text/50">加载中…</p>}

          {error && (
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-zzz-magenta">⚠ {error}</p>
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="glass-btn shrink-0 px-3 py-1 font-mono text-xs text-zzz-text disabled:opacity-40"
              >
                重试
              </button>
            </div>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="font-mono text-xs text-zzz-text/45">还没有赞助记录，成为第一位支持者吧！</p>
          )}

          {rows.length > 0 && (
            <ul className="divide-y divide-zzz-text/10">
              {rows.map((entry, index) => (
                <li key={index} className="flex items-center justify-between gap-3 py-2 font-mono text-xs">
                  <span className="truncate text-zzz-primary/90">{entry.name}</span>
                  <span className="shrink-0 text-zzz-text">¥{entry.amount}</span>
                  <span className="shrink-0 text-[10px] text-zzz-text/40">{formatTime(entry.paidAt, 'Asia/Shanghai')}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
