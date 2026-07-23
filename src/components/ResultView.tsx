import { downloadImage } from '../lib/download';
import { GallerySaveButton, type GallerySaveInfo } from './GallerySaveButton';
import type { GenSlot } from '../types';
import { memo } from 'react';

interface ResultViewProps {
  slot: GenSlot;
  downloadPrefix: string;
  /** Optional action when an image is clicked (e.g. send to viewer). */
  onPick?: (src: string) => void;
  pickLabel?: string;
  /** When provided, a "save to gallery" button appears next to the download button. */
  saveInfo?: GallerySaveInfo;
  /** When provided, an inpaint button appears in the hover toolbar. */
  onInpaintClick?: (src: string, meta: { type: string; slotId?: string; index?: number }) => void;
  inpaintMeta?: { type: string; slotId?: string; index?: number };
  /** Optional image class and key used by callers that animate image replacement. */
  imageClassName?: string;
  imageKey?: string;
}

/** Renders a generation slot: skeleton while loading, images + downloads done. */
export const ResultView = memo(function ResultView({ slot, downloadPrefix, onPick, pickLabel, saveInfo, onInpaintClick, inpaintMeta, imageClassName, imageKey }: ResultViewProps) {
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
            key={imageKey ? `${imageKey}-${i}` : i}
            src={src}
            alt={`${downloadPrefix}-${i + 1}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            fetchPriority={i === 0 ? 'high' : 'auto'}
            decoding="async"
            className={`w-full object-contain${imageClassName ? ` ${imageClassName}` : ''}`}
          />
          <figcaption className="absolute bottom-0 right-0 flex gap-2 p-2 opacity-0 transition-opacity group-hover:opacity-100">
            {saveInfo && <GallerySaveButton saveInfo={saveInfo} />}
            {onPick && (
              <button
                onClick={() => onPick(src)}
                className="glass-btn px-3 py-1 text-xs text-zzz-cyan"
              >
                {pickLabel ?? '送入查看器'}
              </button>
            )}
            {onInpaintClick && inpaintMeta && (
              <button
                onClick={() => onInpaintClick(src, inpaintMeta)}
                className="glass-btn px-3 py-1 text-xs text-[var(--zzz-primary)]"
              >
                🎨 局部重绘
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
});
