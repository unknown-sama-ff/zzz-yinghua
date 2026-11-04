interface Entry {
  dataUrl: string;
  expiresAt: number;
  bytes: number;
}

/** A single budget for all composite results, including their compact keys. */
export class ImageResultCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<string>>();
  private bytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly maxEntries: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number { return this.entries.size; }
  get retainedBytes(): number { return this.bytes; }

  purgeExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.remove(key);
  }

  private remove(key: string): void {
    const entry = this.entries.get(key);
    if (entry) { this.entries.delete(key); this.bytes -= entry.bytes; }
  }

  run(key: string | null, create: () => Promise<string>): Promise<string> {
    // WebCrypto is unavailable on some insecure origins. Skip the optimization
    // there instead of using a collision-prone hash or retaining full inputs.
    if (key === null) return create();
    this.purgeExpired();
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key); this.entries.set(key, hit);
      return Promise.resolve(hit.dataUrl);
    }
    const pending = this.pending.get(key);
    if (pending) return pending;

    // Register before invoking create(), including synchronous exceptions.
    const task = Promise.resolve().then(create).then((dataUrl) => {
      // UTF-16 accounting is deliberately conservative even for Latin-1 data URLs.
      const bytes = 2 * (key.length + dataUrl.length);
      if (bytes <= this.maxBytes && this.maxEntries > 0) {
        this.purgeExpired();
        while (this.entries.size && (this.bytes + bytes > this.maxBytes || this.entries.size >= this.maxEntries)) {
          this.remove(this.entries.keys().next().value!);
        }
        this.entries.set(key, { dataUrl, bytes, expiresAt: this.now() + this.ttlMs });
        this.bytes += bytes;
      }
      return dataUrl;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }
}

/** Hash each source without first copying all base64 strings into one JSON key. */
export async function imageResultKey(operation: string, sources: readonly string[], options?: unknown): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  try {
    const digests = new Map<string, string>();
    const hashes: string[] = [];
    // Bound temporary UTF-8 buffers too: hash one source at a time, and avoid
    // re-encoding duplicate sources within this signature.
    for (const source of sources) {
      let digest = digests.get(source);
      if (digest === undefined) {
        const bytes = await subtle.digest('SHA-256', new TextEncoder().encode(source));
        digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
        digests.set(source, digest);
      }
      hashes.push(digest);
    }
    return JSON.stringify([operation, hashes, options]);
  } catch {
    // Cache availability must not decide whether image preparation succeeds.
    return null;
  }
}
