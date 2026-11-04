// Shared helpers for the Node proxy: fetch with timeout + retry, and SSRF guard.

// Image-to-image editing (gpt-image-2 etc.) can genuinely take several minutes,
// so the per-request ceiling is large by default. Override with
// UPSTREAM_TIMEOUT_MS in .env if your endpoint is faster/slower.
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { Agent, install as installUndici, setGlobalDispatcher } from 'undici';
import ipaddr from 'ipaddr.js';
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
const PUBLIC_REDIRECT_HEADERS = new Set(['accept', 'accept-language', 'user-agent', 'range', 'if-none-match', 'if-modified-since']);
let secureFetchInstalled = false;

/** Diagnostics must not record URL credentials, private paths or signed queries. */
export function logUrlOrigin(value) {
  try { return new URL(value).origin; } catch { return '(invalid URL)'; }
}

/** Validate DNS results at the exact lookup used by the TCP connection. */
export function createPublicLookup(resolve = lookup) {
  return (hostname, options, callback) => {
    const settings = typeof options === 'number' ? { family: options } : options || {};
    resolve(hostname, { ...settings, all: true, verbatim: true }).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isIP(address) || isPrivateIpAddress(address))) {
        callback(new UpstreamError('SSRF_BLOCKED', '已拦截连接时解析到的内网/本地地址', 400)); return;
      }
      if (settings.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    }, callback);
  };
}

/** Keep fetch and its Web API classes aligned; do not rely on Node's older bundled copy. */
export function installSecureFetch() {
  if (secureFetchInstalled) return;
  installUndici();
  setGlobalDispatcher(new Agent({ connect: { lookup: createPublicLookup() } }));
  secureFetchInstalled = true;
}

function isRedirectStatus(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Drop body-related headers for the 301/302/303 → GET method transformation. */
function toGetOptions(options) {
  const headers = new Headers(options.headers || {});
  for (const key of ['content-type', 'content-length', 'transfer-encoding']) {
    headers.delete(key);
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
  const maxResponseBytes = Number(options.maxResponseBytes) > 0 ? Number(options.maxResponseBytes) : 96 * 1024 * 1024;
  const controller = new AbortController();
  const timeoutError = () => new UpstreamError('UPSTREAM_TIMEOUT', `上游请求超时 (${timeout}ms)`, 504);
  let expireBody;
  const timer = setTimeout(() => {
    controller.abort();
    expireBody?.();
  }, timeout);
  // Once headers arrive, the response stream owns the same deadline.
  let bodyOwnsTimer = false;
  function boundedResponse(res) {
    if (!res.body) return res;
    const reader = res.body.getReader();
    let settled = false;
    let total = 0;
    function cleanup() {
      settled = true;
      clearTimeout(timer);
    }
    const body = new ReadableStream({
      start(stream) {
        expireBody = () => {
          if (settled) return;
          cleanup();
          stream.error(timeoutError());
          // A broken upstream need not acknowledge cancellation to let the
          // caller fail promptly. Always observe the cancellation rejection.
          void reader.cancel().catch(() => {});
        };
        if (controller.signal.aborted) expireBody();
      },
      async pull(stream) {
        try {
          const { done, value } = await reader.read();
          if (settled) return;
          if (done) {
            cleanup();
            stream.close();
          } else {
            total += value.byteLength;
            if (total > maxResponseBytes) {
              cleanup();
              stream.error(new UpstreamError('INVALID_INPUT', '上游响应过大，请减少图片数量或降低输出尺寸', 413));
              void reader.cancel().catch(() => {});
            } else stream.enqueue(value);
          }
        } catch (error) {
          if (settled) return;
          cleanup();
          stream.error(controller.signal.aborted ? timeoutError() : error);
        }
      },
      cancel(reason) {
        cleanup();
        void reader.cancel(reason).catch(() => {});
      },
    });
    const response = new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
    for (const property of ['url', 'redirected', 'type']) {
      Object.defineProperty(response, property, { value: res[property] });
    }
    bodyOwnsTimer = true;
    return response;
  }
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
        if (err.code === 'SSRF_BLOCKED' || err.cause?.code === 'SSRF_BLOCKED') throw err.cause?.code === 'SSRF_BLOCKED' ? err.cause : err;
        if (err.name === 'AbortError') {
          console.warn(`[upstream] TIMEOUT after ${Date.now() - started}ms → ${new URL(currentUrl).origin}`);
          throw new UpstreamError('UPSTREAM_TIMEOUT', `上游请求超时 (${timeout}ms)`, 504);
        }
        console.warn('[upstream] FAILED to reach upstream endpoint');
        throw new UpstreamError('UPSTREAM_ERROR', '上游连接失败，请检查 Base URL / 端点是否正确');
      }
      if (!isRedirectStatus(res.status)) return boundedResponse(res);

      const location = res.headers.get('location');
      if (!location) return boundedResponse(res); // 3xx without a Location — surface it as-is
      if (++redirects > MAX_REDIRECTS) {
        await res.body?.cancel?.().catch(() => {});
        throw new UpstreamError('UPSTREAM_ERROR', `上游重定向次数过多 (${MAX_REDIRECTS})`, 502);
      }
      const next = new URL(location, currentUrl);
      try {
        await assertSafeUrl(next.href); // the SSRF check the implicit follow skipped
      } catch (error) {
        void res.body?.cancel?.().catch(() => {});
        throw error;
      }
      const method = String(currentOptions.method || 'GET').toUpperCase();
      if (new URL(currentUrl).origin !== next.origin) {
        if (!['GET', 'HEAD'].includes(method)) {
          void res.body?.cancel?.().catch(() => {});
          throw new UpstreamError('SSRF_BLOCKED', '已阻止接口跨域重定向，请填写最终 Base URL', 400);
        }
        const headers = new Headers(currentOptions.headers || {});
        for (const key of [...headers.keys()]) if (!PUBLIC_REDIRECT_HEADERS.has(key)) headers.delete(key);
        currentOptions = { ...currentOptions, headers };
      }
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        currentOptions = toGetOptions(currentOptions);
      }
      await res.body?.cancel?.().catch(() => {});
      currentUrl = next.href;
    }
  } finally {
    if (!bodyOwnsTimer) clearTimeout(timer);
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
        ([400, 401, 403].includes(err.status) || err.code === 'INVALID_INPUT' || err.code === 'UPSTREAM_TIMEOUT')
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
  try { return ipaddr.process(ip).range() !== 'unicast'; } catch { return true; }
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
 * to an internal address). The installed connection lookup re-checks the exact
 * addresses handed to the TCP connection, closing the DNS lookup/connect gap.
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
  if (url.username || url.password) throw new UpstreamError('SSRF_BLOCKED', 'URL 不允许内嵌用户名或密码', 400);
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
 * Neither logs nor client errors include the raw upstream body, which may
 * contain credentials echoed by an upstream gateway.
 */
export async function parseJsonSafe(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`[upstream] 上游返回非 JSON 响应 status=${res.status}`);
    throw new UpstreamError(
      'UPSTREAM_ERROR',
      '上游返回了非 JSON 响应（检查 Base URL / 端点是否正确）',
    );
  }
}
