import { memo } from 'react';
import { useFreeCreateStore } from '../store/useFreeCreateStore';
import { useInpaintStore } from '../store/useInpaintStore';
import { useViewerStore } from '../store/useViewerStore';

export const FreeCreateButton = memo(function FreeCreateButton() {
  const isOpen = useFreeCreateStore((state) => state.isOpen);
  const open = useFreeCreateStore((state) => state.open);
  const isWorkspaceOpen = useInpaintStore((state) => state.isWorkspaceOpen);
  const viewerFullscreen = useViewerStore((state) => state.viewerFullscreen);

  if (isOpen || isWorkspaceOpen || viewerFullscreen) return null;

  return (
    <button
      type="button"
      onClick={open}
      aria-label="打开自由创作"
      aria-controls="free-create-window"
      aria-expanded={false}
      title="自由创作"
      className="fixed right-5 top-5 z-50 flex items-center gap-2 rounded-full border border-[var(--zzz-primary)]/45 bg-[var(--zzz-ink)]/85 px-4 py-2.5 font-mono text-xs font-bold tracking-wide text-[var(--zzz-text)] shadow-[0_8px_28px_color-mix(in_srgb,var(--zzz-primary)_30%,transparent)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-[var(--zzz-primary)] hover:shadow-[0_10px_30px_color-mix(in_srgb,var(--zzz-primary)_55%,transparent)] focus:outline-none focus:ring-2 focus:ring-[var(--zzz-primary)]/70 sm:right-6 sm:top-6"
    >
      <svg aria-hidden="true" className="h-4 w-4 text-[var(--zzz-primary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18" />
        <path d="M3 12h18" />
        <path d="m18.5 4.5 1 1" />
        <path d="m4.5 18.5 1 1" />
      </svg>
      自由创作
    </button>
  );
});
