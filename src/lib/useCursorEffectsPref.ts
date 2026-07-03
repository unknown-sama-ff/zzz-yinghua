import { useEffect, useState } from 'react';

const STORAGE_KEY = 'yinghua:cursorEffects';

function readStoredPref(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}

/**
 * User's saved cursor-effects preference, combined with the OS-level
 * reduced-motion setting. `reduced` is exposed separately so callers can
 * decide whether to hide the toggle entirely rather than just disable it.
 */
export function useCursorEffectsPref() {
  const [stored, setStored] = useState(readStoredPref);
  const [reduced, setReduced] = useState(prefersReducedMotion);

  useEffect(() => {
    const mql = matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const setEnabled = (value: boolean) => {
    setStored(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
    } catch {
      // ignore storage failures (private mode, quota, etc.)
    }
  };

  return { enabled: stored && !reduced, storedEnabled: stored, reduced, setEnabled };
}
