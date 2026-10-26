import type { ReactNode } from 'react';
import type { GenSlot } from '../types';

export function YinghuaStagePreview({ slot, title, hint, children }: {
  slot: GenSlot;
  title: string;
  hint: string;
  children: ReactNode;
}) {
  const loading = slot.status === 'loading';
  return (
    <div className="yinghua-preview-pane" aria-label={`${title}预览`}>
      <div className="yinghua-preview-heading"><span>{title}</span><small>{loading ? '生成中' : slot.images[0] ? '当前结果' : '等待生成'}</small></div>
      <div className="yinghua-preview-canvas" aria-busy={loading}>
        {slot.images[0] ? children : (
          <div className="yinghua-preview-empty">
            {loading ? <span className="yinghua-loading-mark" aria-hidden="true" /> : <span className="yinghua-preview-frame" aria-hidden="true">↗</span>}
            <strong>{loading ? `正在生成${title}` : `${title}将在这里显示`}</strong>
            <p>{loading ? '完成后会保留在当前步骤，可以预览或继续修改。' : '调整设置后，使用左侧按钮开始创作。'}</p>
          </div>
        )}
        {loading && slot.images[0] && <div className="yinghua-preview-pending">正在生成新版本 · 当前结果仍已保留</div>}
      </div>
      <p className="yinghua-preview-hint">{hint}</p>
    </div>
  );
}
