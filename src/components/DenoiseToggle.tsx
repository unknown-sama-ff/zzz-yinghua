import { memo } from 'react';
import { useProviderStore } from '../store/useProviderStore';

export const DenoiseToggle = memo(function DenoiseToggle({ id, compact = false }: { id: string; compact?: boolean }) {
  const enabled = useProviderStore((state) => state.denoiseEnabled);
  const setEnabled = useProviderStore((state) => state.setDenoiseEnabled);
  return <label htmlFor={id} className={`flex items-start gap-2 font-mono text-xs text-zzz-text/70 ${compact ? 'mb-3' : 'mt-4 border-t border-zzz-text/10 pt-4'}`}>
    <input id={id} type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} aria-label="降噪模式" aria-describedby={`${id}-help`} className="mt-0.5 accent-zzz-primary" />
    <span><span className="block text-zzz-text">降噪模式</span><span id={`${id}-help`} className={`block text-zzz-text/50 ${compact ? 'text-[10px]' : ''}`}>{compact ? '全局同步；开启后新任务追加降噪提示，重试与再画一次沿用原设置。' : '开启后，所有生图与图片编辑自动补充降噪提示词，并尽量保留输入细节。'}</span></span>
  </label>;
});
