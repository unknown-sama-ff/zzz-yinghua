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
      <div className="mt-3 flex h-48 animate-pulse items-center justify-center rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03]">
        <span className="font-mono text-xs tracking-widest text-zzz-primary">
          GENERATING…
        </span>
      </div>
    );
  }

  if (slot.status === 'error') {
    return (
      <div className="mt-3 rounded-xl border border-zzz-magenta/60 bg-zzz-magenta/10 p-3 font-mono text-xs text-zzz-magenta">
        ⚠ {slot.error ?? '生成失败'}
      </div>
    );
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-3">
      {slot.images.map((src, i) => (
        <figure key={i} className="group relative overflow-hidden rounded-xl">
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
                className="glass-btn px-3 py-1 text-xs text-zzz-cyan"
              >
                {pickLabel ?? '送入查看器'}
              </button>
            )}
            <button
              onClick={() => void downloadImage(src, `${downloadPrefix}-${i + 1}.png`)}
              className="glass-btn px-3 py-1 text-xs text-zzz-text"
            >
              下载
            </button>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
