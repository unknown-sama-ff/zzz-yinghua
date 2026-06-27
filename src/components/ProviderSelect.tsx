import { useStore } from '../store/useStore';
import type { ProviderName } from '../types';

const PROVIDERS: { value: ProviderName; label: string }[] = [
  { value: 'seedance', label: 'seedance' },
  { value: 'gpt-image', label: 'gpt-image' },
  { value: 'custom-url', label: 'custom-url' },
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
  } = useStore();

  return (
    <section className="zzz-panel zzz-clip p-5">
      <h2 className="zzz-heading mb-3 text-lg text-zzz-primary">02 · 接口与角色</h2>

      <label className="mb-1 block font-mono text-xs text-zzz-muted">角色英文名</label>
      <input
        value={characterName}
        onChange={(e) => setCharacterName(e.target.value)}
        placeholder="CORIN"
        className="mb-4 w-full border border-zzz-primary/40 bg-zzz-ink px-3 py-2 font-mono uppercase tracking-widest text-zzz-text outline-none focus:border-zzz-primary"
        style={{ borderRadius: 'var(--zzz-radius)' }}
      />

      <label className="mb-1 block font-mono text-xs text-zzz-muted">Provider</label>
      <div className="flex gap-2">
        {PROVIDERS.map((p) => (
          <button
            key={p.value}
            onClick={() => setProvider(p.value)}
            className={`zzz-clip flex-1 border px-2 py-2 font-mono text-xs uppercase transition ${
              provider === p.value
                ? 'border-zzz-primary bg-zzz-primary/25 text-zzz-text shadow-zzz'
                : 'border-zzz-primary/30 text-zzz-muted hover:text-zzz-text'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {provider === 'custom-url' && (
        <div className="mt-4 space-y-3 border-t border-zzz-primary/20 pt-4">
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-muted">Endpoint URL</label>
            <input
              value={custom.endpoint}
              onChange={(e) => setCustom({ endpoint: e.target.value })}
              placeholder="https://api.example.com/v1/images"
              className="w-full border border-zzz-primary/40 bg-zzz-ink px-3 py-2 font-mono text-sm text-zzz-text outline-none focus:border-zzz-primary"
              style={{ borderRadius: 'var(--zzz-radius)' }}
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-muted">
              请求头 // 每行 Key: Value
            </label>
            <textarea
              value={custom.headers}
              onChange={(e) => setCustom({ headers: e.target.value })}
              placeholder={'Authorization: Bearer sk-...\nX-Custom: value'}
              rows={3}
              className="w-full resize-y border border-zzz-primary/40 bg-zzz-ink px-3 py-2 font-mono text-xs text-zzz-text outline-none focus:border-zzz-primary"
              style={{ borderRadius: 'var(--zzz-radius)' }}
            />
          </div>
          <div>
            <label className="mb-1 block font-mono text-xs text-zzz-muted">
              请求体模板 // 可用 {'{prompt}'} {'{image}'} 占位
            </label>
            <textarea
              value={custom.bodyTemplate}
              onChange={(e) => setCustom({ bodyTemplate: e.target.value })}
              placeholder={'{"prompt":"{prompt}","image":"{image}"}'}
              rows={3}
              className="w-full resize-y border border-zzz-primary/40 bg-zzz-ink px-3 py-2 font-mono text-xs text-zzz-text outline-none focus:border-zzz-primary"
              style={{ borderRadius: 'var(--zzz-radius)' }}
            />
          </div>
          <p className="font-mono text-[11px] leading-relaxed text-zzz-muted">
            ⚠ 仅填可信端点。后端会拦截指向 localhost / 内网地址的请求（基础 SSRF 防护）。
          </p>
        </div>
      )}
    </section>
  );
}
