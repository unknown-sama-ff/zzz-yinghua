import type { UpstreamErrorDetails } from '../types';

export function GenerationErrorNotice({ message, upstreamError }: { message?: string; upstreamError?: UpstreamErrorDetails }) {
  if (!message) return null;
  const rejected = /内容审核|safety_violations|rejected by (?:the )?safety system|content_policy_violation|moderation_blocked/i.test(message);
  return (
    <div className="yinghua-error" role="alert">
      <strong>{rejected ? '内容审核未通过' : '本次生成未完成'}</strong>
      {rejected ? <>
        <p>审核类别来自上游。单凭类别不能确定是提示词、参考图还是生成结果触发；本次输入已保留。</p>
        {upstreamError?.source === 'upstream' && typeof upstreamError.message === 'string' ? <details>
          <summary>查看上游原始错误</summary>
          <dl className="yinghua-error-metadata">
            <dt>上游 HTTP 状态</dt><dd>{upstreamError.httpStatus}</dd>
            {upstreamError.code && <><dt>上游错误代码</dt><dd>{upstreamError.code}</dd></>}
            {upstreamError.type && <><dt>上游错误类型</dt><dd>{upstreamError.type}</dd></>}
            {upstreamError.category && <><dt>上游审核类别</dt><dd>{upstreamError.category}</dd></>}
            <dt>上游请求编号</dt><dd>{upstreamError.requestId || '未单独提供，请查看原文'}</dd>
          </dl>
          <p>以下为服务方返回的错误消息{upstreamError.redacted ? '，敏感信息已隐藏' : '，未经翻译或改写'}：</p>
          <pre data-upstream-error-message>{upstreamError.message}</pre>
          {upstreamError.truncated && <p>原始消息过长，当前显示前 8000 个字符。</p>}
        </details> : <details>
          <summary>查看应用提示（非上游原文）</summary>
          <p>当前响应没有提供上游原文，下面仅为应用整理的提示，无法据此还原服务方完整回复。</p>
          <p>{message}</p>
        </details>}
        <p className="yinghua-error-origin">页面说明（本站整理）：错误分类不等于具体原因诊断；不会自动更换参数或重新提交。</p>
      </> : <p>{message}</p>}
    </div>
  );
}
