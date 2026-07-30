/**
 * Shared API base URL for all frontend→backend calls.
 *
 * Dev  : Vite proxies `/api/*` → the local Node proxy (vite.config.ts).
 *        No env var needed — `/api` just works.
 *
 * Prod : When deployed on Vercel (static) the backend lives elsewhere
 *        (Railway / Docker / etc.). Set `VITE_API_BASE_URL` to that
 *        origin (e.g. `https://my-backend.up.railway.app`) and every
 *        fetch hits the real proxy instead of 404-ing on Vercel's CDN.
 */
export const API_BASE: string = (() => {
  const configured = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  return configured ? `${configured}/api` : '/api';
})();
