export function GenerationErrorNotice({ message }: { message?: string }) {
  if (!message) return null;
  const rejected = /内容审核|safety_violations|rejected by (?:the )?safety system|content_policy_violation|moderation_blocked/i.test(message);
  return (
    <div className="yinghua-error" role="alert">
      <strong>{rejected ? '内容审核未通过' : '本次生成未完成'}</strong>
      {rejected ? <>
        <p>请检查参考图与动作说明，使用完整衣装、自然姿态的角色参考。输入已保留，修改后再提交。</p>
        <details><summary>查看错误详情</summary><p>{message}</p></details>
      </> : <p>{message}</p>}
    </div>
  );
}
