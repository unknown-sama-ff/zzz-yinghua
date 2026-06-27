import { useRef } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { fileToDataUrl, validateImageFile } from '../lib/validation';

/**
 * Section 2.5 — assign a PNG source to each of the 6 viewer parts. Sources can
 * come from manual upload here, or from the yinghua results ("→ 查看器").
 */
export function LayerSlots() {
  const { parts, setPartSrc } = useStore();
  const showError = useToast((s) => s.show);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  const pick = async (code: string, file: File) => {
    const check = validateImageFile(file);
    if (!check.ok) {
      showError(check.message ?? '文件校验失败');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setPartSrc(code, dataUrl);
  };

  return (
    <div className="border-t border-zzz-primary/20 p-4">
      <p className="mb-3 font-mono text-xs text-zzz-muted">
        图层素材 // 为 6 个部分分别指定图片（建议透明背景 PNG）
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {parts.map((p) => (
          <div key={p.code} className="flex flex-col items-center gap-1">
            <button
              onClick={() => inputs.current[p.code]?.click()}
              className="relative flex aspect-square w-full items-center justify-center overflow-hidden border border-zzz-primary/30 bg-zzz-ink transition hover:border-zzz-primary"
              style={{ borderRadius: 'var(--zzz-radius)' }}
              aria-label={`为部分 ${p.code} 指定图片`}
            >
              {p.src ? (
                <img src={p.src} alt={`部分 ${p.code}`} className="h-full w-full object-contain" />
              ) : (
                <span className="font-mono text-lg text-zzz-muted">{p.code}</span>
              )}
            </button>
            <span className="font-mono text-[10px] text-zzz-muted">部分 {p.code}</span>
            <input
              ref={(el) => (inputs.current[p.code] = el)}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void pick(p.code, file);
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
