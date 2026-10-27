import { UpstreamError } from '../http.js';

function redactMessage(message, secrets) {
  let safe = message;
  for (const secret of secrets) if (typeof secret === 'string' && secret) safe = safe.split(secret).join('[redacted]');
  return safe
    .replace(/("(?:imageBase64|image_base64|b64_json|base64|maskBase64|mask_base64)"\s*:\s*")[^"]*(")/gi, '$1[image data omitted]$2')
    .replace(/\bBearer\s+[^\s;,"'}]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9]+)/g, '[redacted]')
    .replace(/((?:api[_-]?key|access[_-]?token|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s;,"'}]+/gi, '$1[redacted]')
    .replace(/data:image\/[^\s;,]+;base64,[A-Za-z0-9+/=\r\n]+/gi, '[image data omitted]');
}

function identifier(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,160}$/.test(value) ? value : undefined;
}

/** Keep provider evidence separate from application copy. Never retry a rejection. */
export function contentRejectionError(response, text, secrets = []) {
  const category = text.match(/safety_violations["']?\s*[:=]\s*\[\s*["']?([a-z_-]+)/i)?.[1];
  if (!category && !/rejected by (?:the )?safety system|content_policy_violation|moderation_blocked/i.test(text)) return null;
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const error = body?.error;
  const candidate = error?.request_id ?? body?.request_id ?? response.headers.get('x-request-id');
  const requestId = identifier(candidate);
  const originalMessage = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message
    : typeof body?.message === 'string' ? body.message : text;
  const safeMessage = redactMessage(originalMessage, secrets);
  const rejection = new UpstreamError('CONTENT_REJECTED',
    `上游返回内容审核拒绝${category ? `（${category}）` : ''}。${requestId ? `请求编号：${requestId}` : ''}`,
    400);
  rejection.upstreamError = {
    source: 'upstream', message: safeMessage.slice(0, 8000), httpStatus: response.status,
    code: identifier(error?.code ?? body?.code), type: identifier(error?.type ?? body?.type),
    category, requestId, redacted: safeMessage !== originalMessage, truncated: safeMessage.length > 8000,
  };
  return rejection;
}
