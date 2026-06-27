import { useStore } from '../store/useStore';
import type { ProviderName } from '../types';
import { SectionHeader } from './SectionHeader';

const PROVIDERS: { value: ProviderName; label: string }[] = [
  { value: 'seedance', label: 'seedance' },
  { value: 'gpt-image', label: 'gpt-image' },
  { value: 'custom-url', label: '自定义URL' },
];

/** Provider dropdown + character name; expands custom-url config when chosen. */
export function ProviderSelect() {
  const {
    provider,
    setProvider,
    custom,
    setCustom,
    characterName,
    setCharacterName,
    creds,
    setCred,
  } = useStore();

  const isKeyed = provider === 'seedance' || provider === 'gpt-image';
  const baseUrlPlaceholder =
    provider === 'gpt-image'
      ? 'https://api.openai.com/v1（可留空用默认）'
      : 'https://api.seedance.example/v1';

  return (
    <section className="glass p-6">
      <SectionHeader step="02" title="接口与角色" />

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

      {isKeyed && (
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
              placeholder={provider === 'gpt-image' ? 'sk-...' : '你的 seedance 密钥'}
              className="glass-input w-full px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">
              Base URL // 可选
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
              模型名称 // 可选
            </label>
            <input
              value={creds[provider].model}
              onChange={(e) => setCred(provider, { model: e.target.value })}
              placeholder={provider === 'gpt-image' ? 'gpt-image-1（默认）' : '如 seedance-v1'}
              className="glass-input w-full px-3 py-2 font-mono text-sm"
            />
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-zzz-text/50">
            🔒 密钥仅保存在当前浏览器会话内存，不写入磁盘、不随项目提交；随请求发送到本地后端代理转发上游。
            留空则回退到服务端 .env 配置。
          </p>
        </div>
      )}

      {provider === 'custom-url' && (
        <div className="mt-4 space-y-3 border-t border-zzz-text/10 pt-4">
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">Endpoint URL</label>
            <input
              value={custom.endpoint}
              onChange={(e) => setCustom({ endpoint: e.target.value })}
              placeholder="https://api.example.com/v1/images"
              className="glass-input w-full px-3 py-2 font-mono text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">
              请求头 // 每行 Key: Value
            </label>
            <textarea
              value={custom.headers}
              onChange={(e) => setCustom({ headers: e.target.value })}
              placeholder={'Authorization: Bearer sk-...\nX-Custom: value'}
              rows={3}
              className="glass-input w-full resize-y px-3 py-2 font-mono text-xs"
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-text/60">
              请求体模板 // 可用 {'{prompt}'} {'{image}'} {'{model}'} 占位
            </label>
            <textarea
              value={custom.bodyTemplate}
              onChange={(e) => setCustom({ bodyTemplate: e.target.value })}
              placeholder={'{"prompt":"{prompt}","image":"{image}"}'}
              rows={3}
              className="glass-input w-full resize-y px-3 py-2 font-mono text-xs"
            />
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-zzz-text/50">
            ⚠ 仅填可信端点。后端会拦截指向 localhost / 内网地址的请求（基础 SSRF 防护）。
          </p>
        </div>
      )}
    </section>
  );
}
