import type { FreeCreateAnimationSettings } from '../types';

export function FreeCreateAnimationControls({ id, settings, supported, hasImages, onChange }: {
  id: string;
  settings: FreeCreateAnimationSettings;
  supported: boolean;
  hasImages: boolean;
  onChange: (settings: FreeCreateAnimationSettings) => void;
}) {
  const gif = settings.outputFormat === 'gif';
  const count = settings.frameCount ?? 9;
  const duration = settings.frameDurationMs ?? 200;
  return <div className="mb-3 rounded-xl border border-zzz-text/12 bg-black/15 p-3">
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-xs text-zzz-text/75">输出类型
        <select aria-label="输出类型" value={gif ? 'gif' : 'png'} onChange={(event) => onChange({ outputFormat: event.target.value === 'gif' ? 'gif' : 'png' })} className="glass-input px-2 py-1 text-xs">
          <option value="png">静态图片</option><option value="gif" disabled={!supported}>GIF 动画</option>
        </select>
      </label>
      {!supported && <span className="text-[10px] text-zzz-text/45">GIF 动画需使用 GPT Image 2.6 通道</span>}
      {gif && <span className="text-[10px] text-zzz-cyan">每轮约 {(count * duration / 1000).toFixed(2)} 秒 · 每次 1 部 · 自动尺寸</span>}
    </div>
    {gif && <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-xs text-zzz-text/70">
        <label htmlFor={`gif-frames-${id}`} className="flex items-center gap-2">总帧数
          <input id={`gif-frames-${id}`} type="number" min={2} max={64} step={1} value={count} onChange={(event) => onChange({ frameCount: Number(event.target.value) })} className="glass-input w-20 px-2 py-1" />
        </label>
        <label htmlFor={`gif-duration-${id}`} className="flex items-center gap-2">每帧时长（毫秒）
          <input id={`gif-duration-${id}`} type="number" min={20} max={2000} step={10} value={duration} onChange={(event) => onChange({ frameDurationMs: Number(event.target.value) })} className="glass-input w-24 px-2 py-1" />
        </label>
      </div>
      <p className="text-[10px] leading-relaxed text-zzz-text/50">在提示词中写清主体、动作和循环方式，例如：猫咪挥手，耳朵轻抖，固定镜头，首尾无缝循环。</p>
      <p className="text-[10px] leading-relaxed text-zzz-text/45">帧数越多，生成耗时与文件体积可能越大。画廊单文件上限 10 MB，超出时可直接下载保存。</p>
      {hasImages && <p role="status" className="text-xs text-amber-200">GIF 仅支持文字生成，请先清除主图和参考图。</p>}
      {!supported && <p role="status" className="text-xs text-amber-200">当前通道不支持 GIF，请选择 GPT Image 2.6 或切回静态图片。</p>}
    </div>}
  </div>;
}
