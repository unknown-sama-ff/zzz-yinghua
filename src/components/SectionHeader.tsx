import type { ReactNode } from 'react';

interface SectionHeaderProps {
  step: string;
  title: string;
  /** Optional control rendered on the right (e.g. a toggle). */
  action?: ReactNode;
}

/** Consistent numbered step header used across every panel. */
export function SectionHeader({ step, title, action }: SectionHeaderProps) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="step-badge">{step}</span>
        <h2 className="zzz-heading text-lg text-zzz-text">{title}</h2>
      </div>
      {action}
    </div>
  );
}
