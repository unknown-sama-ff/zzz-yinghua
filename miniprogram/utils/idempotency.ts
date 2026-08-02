const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Generate a payment/generation idempotency key without crypto.randomUUID.
 * Must match the server regex /^[A-Za-z0-9_-]{16,128}$/.
 */
export function createIdempotencyKey(): string {
  let out = '';
  for (let i = 0; i < 24; i++) {
    out += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return out;
}

/** Generate a gallery delete token (16-64 chars [A-Za-z0-9_-]) for ownership. */
export function createGalleryDeleteToken(): string {
  return `${Date.now().toString(36)}-${createIdempotencyKey()}`;
}
