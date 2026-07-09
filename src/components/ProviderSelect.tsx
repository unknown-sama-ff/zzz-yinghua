import { useStore } from '../store/useStore';
import type { ProviderName } from '../types';
import { SectionHeader } from './SectionHeader';

const PROVIDERS: { value: ProviderName; label: string }[] = [
  { value: 'seedream', label: 'seedream' },
  { value: 'gpt-image', label: 'gpt-image' },
  { value: 'custom-url', label: '自定义URL' },
];

/** Provider dropdown + character name; expands custom-url config when chosen. */
export function ProviderSelect() {
  const provider = useStore((s) => s.provider);
  const setProvider = useStore((s) => s.setProvider);
  const custom = useStore((s) => s.custom);
  const setCustom = useStore((s) => s.setCustom);
  const characterName = useStore((s) => s.characterName);
  const setCharacterName = useStore((s) => s.setCharacterName);
  const creds = useStore((s) => s.creds);
  const setCred = useStore((s) => s.setCred);
  const freeloadEnabled = useStore((s) => s.freeloadEnabled);
  const visionCred = useStore((s) => s.visionCred);
  const setVisionCred = useStore((s) => s.setVisionCred);

  const isKeyed = provider === 'seedream' || provider === 'gpt-image' || provider === 'custom-url';
  const baseUrlPlaceholder =
    provider === 'gpt-image'
      ? 'https://api.openai.com/v1（可留空用默认）'
      : provider === 'custom-url'
        ? 'https://yunwu.ai/v1/images/generations（完整端点，不含自动后缀）'
        : 'https://api.seedream.example/v1';

  return (
    <section className="glass p-6">
      <SectionHeader step="03" title="接口与角色（中转站URL后加/v1）" />
      <p className="mb-4 font-mono text-xs text-red-400/80">⚠ seedream效果不好，不推荐</p>

      <label className="mb-1 block font-mono text-xs text-zzz-text/60">角色英文名</label>
      <input
        value={characterName}
        onChange={(e) => setCharacterName(e.target.value)}
        placeholder="CORIN"
        className="glass-input mb-4 w-full px-3 py-2 font-mono uppercase tracking-widest"
      />

      <label className="mb-1 block font-mono text-xs text-zzz-text/60">Provider</label>
      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.value}
            onClick={() => setProvider(p.value)}
            data-active={provider === p.value}
            className="glass-btn flex-1 px-2 py-2.5 font-mono text-xs text-zzz-text"
          >
            {p.label}
          </button>
        ))}
      </div>

      {isKeyed && !freeloadEnabled && (
        <div className="mt-4 space-y-3 border-t border-zzz-text/10 pt-4">
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">
              API Key // {provider}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={creds[provider].apiKey}
              onChange={(e) => setCred(provider, { apiKey: e.target.value })}
              placeholder={
                provider === 'custom-url'
                  ? 'sk-...（自动生成 Authorization: Bearer 请求头）'
                  : provider === 'gpt-image'
                    ? 'sk-...'
                    : '你的 seedream 密钥'
              }
              className="glass-input w-full px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">
              Base URL // {provider === 'custom-url' ? '完整端点路径' : '可选'}
            </label>
            <input
              value={creds[provider].baseUrl}
              onChange={(e) => setCred(provider, { baseUrl: e.target.value })}
              placeholder={baseUrlPlaceholder}
              className="glass-input w-full px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">
              模型名称 // {provider === 'custom-url' ? '填入请求体' : '可选'}
            </label>
            <input
              value={creds[provider].model}
              onChange={(e) => setCred(provider, { model: e.target.value })}
              placeholder={
                provider === 'custom-url'
                  ? 'gemini-3.1-flash-lite-image'
                  : provider === 'gpt-image'
                    ? 'gpt-image-2（默认）'
                    : '如 seedream-v1'
              }
              className="glass-input w-full px-3 py-2 font-mono text-sm"
            />
          </div>
          {provider === 'custom-url' && (
            <div>
              <label className="mb-1 block font-mono text-xs text-zzz-text/60">
                请求体模板 // 可用 {'{prompt}'} {'{image}'} {'{model}'} 占位
              </label>
              <textarea
                value={custom.bodyTemplate}
                onChange={(e) => setCustom({ bodyTemplate: e.target.value })}
                placeholder={'{"model":"{model}","prompt":"{prompt}","n":1}'}
                rows={3}
                className="glass-input w-full resize-y px-3 py-2 font-mono text-xs"
              />
            </div>
          )}
          <p className="font-mono text-[11px] leading-relaxed text-zzz-text/50">
            {provider === 'custom-url'
              ? '🔒 密钥仅保存在当前浏览器会话内存。后端会拦截指向 localhost / 内网地址的请求（基础 SSRF 防护）。'
              : '🔒 密钥仅保存在当前浏览器会话内存，不写入磁盘、不随项目提交；随请求发送到本地后端代理转发上游。留空则回退到服务端 .env 配置。'
            }
          </p>
        </div>
      )}

      {freeloadEnabled && (
        <div className="mt-4 border-t border-zzz-text/10 pt-4">
          <p className="font-mono text-[11px] leading-relaxed text-zzz-primary/80">
            已启用作者预设通道
          </p>
        </div>
      )}

      {/* Vision model config — always shown; used for face detection clip regions */}
      {!freeloadEnabled && (
        <div className="mt-4 space-y-2 border-t border-zzz-text/10 pt-4">
          <label className="font-mono text-xs text-zzz-text/60">视觉模型 // 人脸识别裁切</label>
          <input
            type="password"
            autoComplete="off"
            value={visionCred.apiKey}
            onChange={(e) => setVisionCred({ apiKey: e.target.value })}
            placeholder="API Key（留空则使用服务端 VISION_API_KEY）"
            className="glass-input w-full px-3 py-2 font-mono text-sm"
          />
          <input
            value={visionCred.baseUrl}
            onChange={(e) => setVisionCred({ baseUrl: e.target.value })}
            placeholder="Base URL（可选，默认 api.openai.com）"
            className="glass-input w-full px-3 py-2 font-mono text-sm"
          />
          <input
            value={visionCred.model}
            onChange={(e) => setVisionCred({ model: e.target.value })}
            placeholder="模型名称（可选，默认 gpt-4o-mini）"
            className="glass-input w-full px-3 py-2 font-mono text-sm"
          />
          <p className="font-mono text-[11px] leading-relaxed text-zzz-text/50">
            用于零命图片生成后自动检测人脸位置，动态计算切割区域。Key 留空时使用服务端 .env 的 VISION_API_KEY；若均未配置则报错。
          </p>
        </div>
      )}
    </section>
  );
}
