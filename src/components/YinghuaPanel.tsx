import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_STYLES, fillName } from '../lib/prompts';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import type { YinghuaStyleId } from '../types';

/** Section 2.4 — generate the three ZZZ yinghua action styles. */
export function YinghuaPanel() {
  const {
    characterName,
    yinghuaPrompts,
    setYinghuaPrompt,
    yinghuaSlots,
    setYinghuaSlot,
    uploadedImage,
    parts,
    setPartSrc,
  } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  // Seed each style's editable prompt from its template once a name is known.
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      if (!yinghuaPrompts[style.id]) {
        setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fill prompts when the name changes (only if still untouched defaults).
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterName]);

  const run = async (id: YinghuaStyleId) => {
    if (!uploadedImage) {
      showError('请先上传角色正面图片');
      return;
    }
    setYinghuaSlot(id, { status: 'loading', error: undefined });
    try {
      const images = await generate(buildRequest(yinghuaPrompts[id]));
      setYinghuaSlot(id, { status: 'done', images });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setYinghuaSlot(id, { status: 'error', error: msg });
      showError(msg);
    }
  };

  // Assign a picked image to the first part that has no source yet.
  const sendToViewer = (src: string) => {
    const target = parts.find((p) => !p.src);
    if (!target) {
      showError('查看器 6 个部分已全部分配，可在查看器中替换');
      return;
    }
    setPartSrc(target.code, src);
  };

  return (
    <section className="zzz-panel zzz-clip p-5">
      <h2 className="zzz-heading mb-3 text-lg text-zzz-primary">04 · 影画动作设计 · 三风格</h2>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {YINGHUA_STYLES.map((style) => (
          <div key={style.id} className="flex flex-col border border-zzz-primary/25 p-3" style={{ borderRadius: 'var(--zzz-radius)' }}>
            <h3 className="font-mono text-sm text-zzz-magenta">
              样式 {style.id} · {style.label}
            </h3>
            <p className="mb-2 mt-1 text-xs leading-relaxed text-zzz-muted">{style.description}</p>
            <textarea
              value={yinghuaPrompts[style.id]}
              onChange={(e) => setYinghuaPrompt(style.id, e.target.value)}
              rows={5}
              className="w-full flex-1 resize-y border border-zzz-primary/30 bg-zzz-ink px-2 py-2 text-xs leading-relaxed text-zzz-text outline-none focus:border-zzz-primary"
              style={{ borderRadius: 'var(--zzz-radius)' }}
            />
            <button
              onClick={() => void run(style.id)}
              disabled={yinghuaSlots[style.id].status === 'loading'}
              className="zzz-clip mt-2 border border-zzz-primary bg-zzz-primary/20 py-2 font-mono text-xs uppercase tracking-widest text-zzz-text transition hover:bg-zzz-primary/35 disabled:opacity-50"
            >
              生成
            </button>
            <ResultView
              slot={yinghuaSlots[style.id]}
              downloadPrefix={`yinghua-style${style.id}`}
              onPick={sendToViewer}
              pickLabel="→ 查看器"
            />
          </div>
        ))}
      </div>
    </section>
  );
}
