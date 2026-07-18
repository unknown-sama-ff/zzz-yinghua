// ── Timeouts (ms) ────────────────────────────────────────────────────────────

/** Default upstream request timeout (5 min). */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 300_000;

/** Generate / inpaint request timeout (6 min). */
export const GENERATE_TIMEOUT_MS = 360_000;

/** JSON worker off-thread parse timeout (1 min). */
export const JSON_WORKER_TIMEOUT_MS = 60_000;

/** Long-task poll deadline (3 min). */
export const POLL_DEADLINE_MS = 180_000;

/** Long-task poll interval (3 s). */
export const POLL_INTERVAL_MS = 3_000;

/** Image worker request timeout (6 min). */
export const WORKER_TIMEOUT_MS = 360_000;

/** Stitch/embed cache TTL (5 min). */
export const CACHE_TTL_MS = 5 * 60_000;

/** Cache purge interval (1 min). */
export const CACHE_PURGE_INTERVAL_MS = 60_000;

/** Face detection request timeout (3 min). */
export const FACE_DETECT_TIMEOUT_MS = 180_000;

// ── Image sizes ───────────────────────────────────────────────────────────────

/** Max dimension for server-side compression. */
export const MAX_COMPRESS_DIM = 1024;

/** JPEG quality for compression (0–1). */
export const JPEG_QUALITY = 0.80;

/** Max stitch height (px). */
export const MAX_STITCH_HEIGHT = 1536;

/** Retry resize dimension when upload exceeds threshold. */
export const RETRY_RESIZE_DIM = 512;

/** Retry threshold in KB — images above this get downscaled on 400 error. */
export const RETRY_SIZE_KB_THRESHOLD = 300;

/** Face detection max dimension. */
export const FACE_DETECT_MAX_DIM = 384;

// ── UI ───────────────────────────────────────────────────────────────────────

/** Max inpaint undo history entries. */
export const MAX_UNDO_HISTORY = 20;

/** Default brush size (px). */
export const DEFAULT_BRUSH_SIZE = 24;

/** Default feather radius (px). */
export const DEFAULT_FEATHER_RADIUS = 12;

/** Brush size min/max. */
export const BRUSH_SIZE_MIN = 5;
export const BRUSH_SIZE_MAX = 80;

/** Feather radius min/max. */
export const FEATHER_RADIUS_MIN = 0;
export const FEATHER_RADIUS_MAX = 30;

/** Zoom min/max. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3;

// ── File limits ──────────────────────────────────────────────────────────────

/** Max uploaded file size (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Accepted MIME types for upload. */
export const ACCEPTED_UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

// ── Server ───────────────────────────────────────────────────────────────────

/** Task store TTL (5 min). */
export const TASK_TTL_MS = 5 * 60_000;

/** Default server request timeout. */
export const SERVER_DEFAULT_TIMEOUT_MS = 300_000;

/** Retry attempts for upstream requests. */
export const UPSTREAM_RETRIES = 2;
