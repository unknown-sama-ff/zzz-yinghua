const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * CSPRNG-backed random string of `count` chars drawn from CHARS. Uses
 * crypto.getRandomValues when the runtime provides it (modern mini-program JS
 * engines do); falls back to Math.random only where no secure source exists.
 * 64 chars divides 256 evenly, so the modulo mapping is unbiased.
 */
function randomChars(count: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(count);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < count; i++) out += CHARS[bytes[i] % CHARS.length];
    return out;
  }
  let out = '';
  for (let i = 0; i < count; i++) out += CHARS[Math.floor(Math.random() * CHARS.length)];
  return out;
}

/**
 * Generate a payment/generation idempotency key without crypto.randomUUID.
 * Must match the server regex /^[A-Za-z0-9_-]{16,128}$/.
 */
export function createIdempotencyKey(): string {
  return randomChars(24);
}

/**
 * Generate a gallery delete token (16-64 chars [A-Za-z0-9_-]) for ownership.
 * CSPRNG-backed with NO predictable timestamp prefix: the token's SHA-256 hash
 * is the deletion capability, so the token must carry full entropy.
 */
export function createGalleryDeleteToken(): string {
  return randomChars(32);
}
