import { downloadImage } from '../lib/download';
import type { GenSlot } from '../types';

interface ResultViewProps {
  slot: GenSlot;
  downloadPrefix: string;
  /** Optional action when an image is clicked (e.g. send to viewer). */
  onPick?: (src: string) => void;
  pickLabel?: string;
}

/** Renders a generation slot: skeleton while loading, images + downloads done. */
export function ResultView({ slot, downloadPrefix, onPick, pickLabel }: ResultViewProps) {
  if (slot.status === 'idle') return null;

  if (slot.status === 'loading') {
    return (
      <div
        className="mt-3 flex h-48 animate-pulse items-center justify-center border border-zzz-primary/30 bg-zzz-ink"
        style={{ borderRadius: 'var(--zzz-radius)' }}
      >
        <span className="font-mono text-xs tracking-widest text-zzz-primary">
          GENERATING…
        </span>
      </div>
    );
  }

  if (slot.status === 'error') {
    return (
      <div
        className="mt-3 border border-zzz-magenta/60 bg-zzz-ink p-3 font-mono text-xs text-zzz-magenta"
        style={{ borderRadius: 'var(--zzz-radius)' }}
      >
        ⚠ {slot.error ?? '生成失败'}
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-3">
      {slot.images.map((src, i) => (
        <figure key={i} className="group relative overflow-hidden" style={{ borderRadius: 'var(--zzz-radius)' }}>
          <img
            src={src}
            alt={`${downloadPrefix}-${i + 1}`}
            loading="lazy"
            className="w-full object-contain"
          />
          <figcaption className="absolute bottom-0 right-0 flex gap-2 p-2 opacity-0 transition-opacity group-hover:opacity-100">
            {onPick && (
              <button
                onClick={() => onPick(src)}
                className="zzz-clip border border-zzz-cyan bg-zzz-ink/90 px-3 py-1 text-xs text-zzz-cyan"
              >
                {pickLabel ?? '送入查看器'}
              </button>
            )}
            <button
              onClick={() => void downloadImage(src, `${downloadPrefix}-${i + 1}.png`)}
              className="zzz-clip border border-zzz-primary bg-zzz-ink/90 px-3 py-1 text-xs text-zzz-primary"
            >
              下载
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
