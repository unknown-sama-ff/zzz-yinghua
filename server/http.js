// Shared helpers for the Node proxy: fetch with timeout + retry, and SSRF guard.

const DEFAULT_TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 60000);

/** Normalized upstream error carrying a stable code for the client. */
export class UpstreamError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 502;
  }
}

/** fetch() with an AbortController timeout. */
export async function fetchWithTimeout(url, options = {}, timeout = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new UpstreamError('UPSTREAM_TIMEOUT', `上游请求超时 (${timeout}ms)`, 504);
    }
    throw new UpstreamError('UPSTREAM_ERROR', `上游连接失败: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Run an async fn with up to `retries` exponential-backoff retries. */
export async function withRetry(fn, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Don't retry client-caused errors.
      if (err instanceof UpstreamError && [400, 401, 403].includes(err.status)) {
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
 * Basic SSRF guard for the custom-url provider. Blocks loopback, link-local,
 * and private network ranges. Not exhaustive, but covers the obvious cases.
 */
export function assertSafeUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UpstreamError('SSRF_BLOCKED', '自定义 URL 无效', 400);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new UpstreamError('SSRF_BLOCKED', '仅允许 http/https 协议', 400);
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (blocked) {
    throw new UpstreamError(
      'SSRF_BLOCKED',
      `已拦截指向内网/本地地址的请求: ${host}`,
      400,
    );
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
