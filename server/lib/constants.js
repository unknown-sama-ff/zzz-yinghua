// ── Server-side constants ─────────────────────────────────────────────────────

/** Default upstream request timeout (ms). */
export const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 300000);

/** Poll deadline for long-running tasks (ms). */
export const POLL_DEADLINE_MS = 180000;

/** Max dimension for server-side image compression. */
export const MAX_COMPRESS_DIM = 1024;

/** JPEG quality for server-side compression (0–1). */
export const JPEG_QUALITY = 0.80;

/** Retry resize dimension when upload exceeds threshold. */
export const RETRY_RESIZE_DIM = 512;

/** Retry threshold in KB — images above this get downscaled on 400 error. */
export const RETRY_SIZE_KB_THRESHOLD = 300;

/** JPEG quality for retry (lower quality for smaller payload). */
export const RETRY_JPEG_QUALITY = 0.70;

/** Retry attempts for upstream requests. */
export const UPSTREAM_RETRIES = 2;

/** Max uploaded file size (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Task store TTL (5 min). */
export const TASK_TTL_MS = 5 * 60_000;
