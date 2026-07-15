import { useEffect, memo } from 'react';

interface ToastProps {
  message: string;
  onClose: () => void;
}

/** ZZZ-styled transient error banner (replaces native alert). */
export const Toast = memo(function Toast({ message, onClose }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      role="alert"
      className="glass fixed bottom-6 left-1/2 z-[10000] -translate-x-1/2 px-5 py-3"
      style={{ borderColor: 'var(--zzz-magenta)' }}
    >
      <div className="flex items-center gap-3">
        <span className="font-mono text-xs tracking-widest text-zzz-magenta">
          ⚠ ERROR
        </span>
        <span className="text-sm text-zzz-text">{message}</span>
        <button
          onClick={onClose}
          aria-label="关闭提示"
          className="ml-2 font-mono text-zzz-text/50 hover:text-zzz-text"
        >
          ✕
        </button>
      </div>
    </div>
  );
});
