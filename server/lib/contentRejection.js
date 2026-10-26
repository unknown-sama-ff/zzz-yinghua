import { UpstreamError } from '../http.js';

/** A moderation rejection is terminal, regardless of the relay's HTTP status. */
export function contentRejectionError(response, text) {
  const category = text.match(/safety_violations["']?\s*[:=]\s*\[\s*["']?([a-z_-]+)/i)?.[1];
  if (!category && !/rejected by (?:the )?safety system|content_policy_violation|moderation_blocked/i.test(text)) return null;
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  const error = body?.error;
  const candidate = error?.request_id ?? body?.request_id ?? response.headers.get('x-request-id');
  const requestId = typeof candidate === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(candidate) ? candidate : null;
  return new UpstreamError('CONTENT_REJECTED',
    `模型内容审核未通过${category ? `（${category}）` : ''}。请检查参考图与动作说明，使用完整衣装、自然姿态的角色参考；本次不会自动重试。${requestId ? `请求编号：${requestId}` : ''}`,
    400);
}
