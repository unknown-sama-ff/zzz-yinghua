// ── Server-side constants ─────────────────────────────────────────────────────

/** Default upstream request timeout (ms). */
export const DEFAULT_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 300000);

/** Poll deadline for long-running tasks (ms). */
export const POLL_DEADLINE_MS = 180000;

/** Max dimension for server-side image compression. */
export const MAX_COMPRESS_DIM = 1024;

/** Maximum high-fidelity primary image dimension accepted for 六命阳 edits. */
export const MAX_HIGH_FIDELITY_EDIT_DIM = 1536;

/** JPEG quality for server-side compression (1–100). */
export const JPEG_QUALITY = 80;

/** Retry resize dimension when upload exceeds threshold. */
export const RETRY_RESIZE_DIM = 512;

/** Retry threshold in KB — images above this get downscaled on 400 error. */
export const RETRY_SIZE_KB_THRESHOLD = 300;

/** JPEG quality for retry (lower quality for smaller payload). */
export const RETRY_JPEG_QUALITY = 70;

/** Retry attempts for upstream requests. */
export const UPSTREAM_RETRIES = 2;

/** Max uploaded file size (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Max pixels sharp will decompress (64 MP) — bounds memory on hostile images. */
export const MAX_INPUT_PIXELS = 64_000_000;

/** Max bytes a server-side remote image fetch will read (20 MB). */
export const MAX_FETCH_BYTES = 20 * 1024 * 1024;

/** Max images a single generate request may ask an upstream for. */
export const MAX_GENERATE_N = 4;

/**
 * Max input images (primary + references) one free-creation turn may send.
 * Free creation lets the user attach 16 references on top of the current image
 * context, so it opts out of the per-model table the yinghua pipeline uses.
 */
export const FREE_CREATE_MAX_INPUT_IMAGES = 17;

/** Task store TTL (5 min). */
export const TASK_TTL_MS = 5 * 60_000;
