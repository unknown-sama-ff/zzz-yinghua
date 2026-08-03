// Shared helpers for the Node proxy: fetch with timeout + retry, and SSRF guard.

// Image-to-image editing (gpt-image-2 etc.) can genuinely take several minutes,
// so the per-request ceiling is large by default. Override with
// UPSTREAM_TIMEOUT_MS in .env if your endpoint is faster/slower.
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { DEFAULT_TIMEOUT_MS, UPSTREAM_RETRIES, MAX_FETCH_BYTES } from './lib/constants.js';

/** Normalized upstream error carrying a stable code for the client. */
export class UpstreamError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 502;
  }
}

const MAX_REDIRECTS = 5;

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Drop body-related headers for the 301/302/303 → GET method transformation. */
function toGetOptions(options) {
  const headers = { ...(options.headers || {}) };
  for (const key of ['content-type', 'content-length', 'transfer-encoding']) {
    delete headers[key];
    delete headers[key.toLowerCase()];
  }
  return { ...options, method: 'GET', body: undefined, headers };
}

/**
 * fetch() with an AbortController timeout and SSRF-safe redirect handling.
 *
 * Redirects are followed manually, never implicitly: callers validate the
 * initial URL with assertSafeUrl (every outbound sink does), and EVERY redirect
 * target is re-validated by assertSafeUrl before being fetched. Without this, a
 * public endpoint could 302/307 the proxy into an internal network — the
 * classic redirect-based SSRF bypass of a first-hop-only guard.
 *
 * Methods/bodies are transformed per the HTTP spec: 303 → GET; 301/302 on a
 * POST → GET; 307/308 preserve the method and body.
 */
export async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const started = Date.now();
  let currentUrl = url;
  let currentOptions = options;
  let redirects = 0;
  try {
    for (;;) {
      let res;
      try {
        res = await fetch(currentUrl, { ...currentOptions, redirect: 'manual', signal: controller.signal });
      } catch (err) {
        if (err.name === 'AbortError') {
          console.warn(`[upstream] TIMEOUT after ${Date.now() - started}ms → ${currentUrl}`);
          throw new UpstreamError('UPSTREAM_TIMEOUT', `上游请求超时 (${timeout}ms)`, 504);
        }
        console.warn('[upstream] FAILED to reach upstream endpoint');
        throw new UpstreamError('UPSTREAM_ERROR', '上游连接失败，请检查 Base URL / 端点是否正确');
      }
      if (!isRedirectStatus(res.status)) return res;

      const location = res.headers.get('location');
      if (!location) return res; // 3xx without a Location — surface it as-is
      if (++redirects > MAX_REDIRECTS) {
        await res.body?.cancel?.().catch(() => {});
        throw new UpstreamError('UPSTREAM_ERROR', `上游重定向次数过多 (${MAX_REDIRECTS})`, 502);
      }
      const next = new URL(location, currentUrl);
      await assertSafeUrl(next.href); // the SSRF check the implicit follow skipped
      const method = String(currentOptions.method || 'GET').toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        currentOptions = toGetOptions(currentOptions);
      }
      await res.body?.cancel?.().catch(() => {});
      currentUrl = next.href;
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a URL (with the same SSRF-safe redirect handling as fetchWithTimeout)
 * and return its body as a Buffer, capped at maxBytes. A response advertising a
 * content-length above the cap is rejected up front; otherwise the size limit
 * is enforced while streaming so a lying/missing content-length can't slip a
 * huge body through (memory-DoS guard for the image-proxy paths).
 */
export async function fetchBufferLimited(
  url,
  options = {},
  timeout = DEFAULT_TIMEOUT_MS,
  maxBytes = MAX_FETCH_BYTES,
) {
  const res = await fetchWithTimeout(url, options, timeout);
  const contentType = res.headers.get('content-type') || '';
  const advertised = Number(res.headers.get('content-length'));
  if (Number.isFinite(advertised) && advertised > maxBytes) {
    await res.body?.cancel?.().catch(() => {});
    return { ok: false, status: 413, buffer: null, contentType };
  }
  const reader = res.body?.getReader();
  if (!reader) {
    const arrayBuffer = await res.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      return { ok: false, status: 413, buffer: null, contentType };
    }
    return { ok: res.ok, status: res.status, buffer: Buffer.from(arrayBuffer), contentType };
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, buffer: null, contentType };
    }
    chunks.push(Buffer.from(value));
  }
  return { ok: res.ok, status: res.status, buffer: Buffer.concat(chunks), contentType };
}

/** Run an async fn with up to `retries` exponential-backoff retries. */
export async function withRetry(fn, retries = UPSTREAM_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry client-caused errors, nor timeouts: retrying a full
      // request that already ran to the timeout ceiling just multiplies the
      // user's wait (e.g. 3 × 120s) and rarely succeeds. Retry only transient
      // network / 5xx upstream failures.
      if (
        err instanceof UpstreamError &&
        ([400, 401, 403].includes(err.status) || err.code === 'UPSTREAM_TIMEOUT')
      ) {
        throw err;
      }
      if (attempt < retries) {
        await sleep(2 ** attempt * 500); // 500ms, 1s, 2s
      }
    }
  }
  throw lastErr;
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True for IPs we never want the proxy to reach: loopback, private ranges,
 * link-local, CGNAT, and reserved/documentation blocks. Handles dotted-quad
 * IPv4, IPv6 (including IPv4-mapped), unique-local and link-local v6.
 */
function isPrivateIpAddress(ip) {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 ||                          // 0.0.0.0/8
      a === 10 ||                         // 10.0.0.0/8
      a === 127 ||                        // 127.0.0.0/8 loopback
      (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 CGNAT
      (a === 169 && b === 254) ||         // 169.254.0.0/16 link-local
      (a === 172 && b >= 16 && b <= 31) ||// 172.16.0.0/12
      (a === 192 && b === 168) ||         // 192.168.0.0/16
      (a === 192 && b === 0) ||           // 192.0.0.0/24
      (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15 benchmark
      (a === 198 && b === 51) ||          // 198.51.100.0/24 TEST-NET-2
      (a === 203 && b === 0) ||           // 203.0.113.0/24 TEST-NET-3
      a >= 224                            // multicast + reserved
    );
  }
  if (family === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped IPv6 (::ffff:a.b.c.d or the hextet form ::ffff:7f00:1 that
    // Node's URL normalizer produces). Check the embedded IPv4.
    if (lower.startsWith('::ffff:')) {
      const tail = lower.slice(7); // after '::ffff:'
      if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return isPrivateIpAddress(tail);
      const hextets = tail.split(':').filter(Boolean);
      if (hextets.length >= 2) {
        const hi = parseInt(hextets[hextets.length - 2], 16);
        const lo = parseInt(hextets[hextets.length - 1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          const embedded = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isPrivateIpAddress(embedded);
        }
      }
      return true; // unrecognized mapped form — block defensively
    }
    if (lower === '::' || lower === '::1') return true;
    // fc00::/7 unique-local, fe80::/10 link-local
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower)) return true;
    // Reserved/documentation + Teredo (2001::/32 can embed IPv4).
    if (lower.startsWith('2001:db8') || lower.startsWith('2001:0')) return true;
    return false;
  }
  return false;
}

/**
 * Hostnames that look like IPv4 written in an alternate notation (bare decimal
 * integer, hex, octal, or shorthand dotted forms such as 127.1 / 0177.0.0.1).
 * Node may normalize these at connect time, so treat them as IP literals.
 */
function looksLikeNumericIp(host) {
  return (
    /^0x[0-9a-f]+$/i.test(host) ||  // hex
    /^0[0-7]+$/.test(host) ||       // octal
    /^\d+$/.test(host) ||           // bare decimal integer
    /^\d+(?:\.\d+){1,3}$/.test(host) // dotted numeric (incl. shorthand)
  );
}

/**
 * Hardened SSRF guard (async). Blocks non-http(s) schemes, IP literals in any
 * notation that fall on private/loopback/link-local ranges, reserved TLDs, and
 * hostnames whose DNS resolution returns any non-public address. This closes
 * the obvious bypasses (IPv4-mapped IPv6, decimal/hex/octal IPs, DNS rebinding
 * to an internal address). Note: a rebinding *proof* guard would additionally
 * pin the connection to the validated address; this mitigates it by resolving
 * and re-checking at request time.
 */
export async function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UpstreamError('SSRF_BLOCKED', '自定义 URL 无效', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UpstreamError('SSRF_BLOCKED', '仅允许 http/https 协议', 400);
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) {
    throw new UpstreamError('SSRF_BLOCKED', 'URL 缺少主机名', 400);
  }
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) {
    throw new UpstreamError('SSRF_BLOCKED', `已拦截指向内网/本地地址的请求: ${host}`, 400);
  }
  if (isIP(host) !== 0) {
    if (isPrivateIpAddress(host)) {
      throw new UpstreamError('SSRF_BLOCKED', `已拦截指向内网/本地地址的请求: ${host}`, 400);
    }
    return url;
  }
  if (looksLikeNumericIp(host)) {
    throw new UpstreamError('SSRF_BLOCKED', `已拦截非法 IP 字面量: ${host}`, 400);
  }
  let addresses = [];
  try {
    const result = await lookup(host, { all: true, verbatim: true });
    addresses = Array.isArray(result) ? result.map((a) => a.address) : [result.address];
  } catch {
    throw new UpstreamError('SSRF_BLOCKED', `无法解析主机名: ${host}`, 400);
  }
  for (const addr of addresses) {
    if (isPrivateIpAddress(addr)) {
      throw new UpstreamError('SSRF_BLOCKED', `已拦截指向内网/本地地址的请求: ${host}`, 400);
    }
  }
  return url;
}

/** Map an arbitrary upstream HTTP status to a stable client error code. */
export function codeFromStatus(status) {
  if (status === 401 || status === 403) return 'UNAUTHORIZED';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 408 || status === 504) return 'UPSTREAM_TIMEOUT';
  return 'UPSTREAM_ERROR';
}

/**
 * Parse a Response as JSON, but fail cleanly when the upstream returns HTML or
 * other non-JSON (wrong Base URL, login/404 page, gateway error page). Without
 * this, res.json() throws a raw SyntaxError that surfaces as an opaque UNKNOWN.
 *
 * The response body is only logged server-side — never echoed into the
 * client-visible message, which would otherwise act as a read channel for any
 * endpoint the proxy can reach (see SSRF guard).
 */
export async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`[upstream] 上游返回非 JSON 响应，前 120 字符: ${text.trim().slice(0, 120).replace(/\s+/g, ' ')}`);
    throw new UpstreamError(
      'UPSTREAM_ERROR',
      '上游返回了非 JSON 响应（检查 Base URL / 端点是否正确）',
    );
  }
}
