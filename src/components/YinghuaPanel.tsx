import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_STYLES, YINGHUA_SIZE, fillName } from '../lib/prompts';
import { parseDataUrl } from '../lib/validation';
import { detectFace } from '../lib/detectFace';
import { computeClipRegions } from '../lib/clipRegions';
import { useBuildRequest } from './useBuildRequest';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';
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
    palette,
    visionCred,
    setViewerClipRegions,
    setDetectFaceError,
  } = useStore();
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  // Seed each style's editable prompt from its template once a name is known.
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      if (!yinghuaPrompts[style.id]) {
        setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fill prompts when the name changes.
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterName]);

  // Re-fill prompts when palette changes (new image uploaded).
  useEffect(() => {
    for (const style of YINGHUA_STYLES) {
      setYinghuaPrompt(style.id, fillName(style.promptTemplate, characterName, palette ?? undefined));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  const runFaceDetect = async (src: string) => {
    setDetectFaceError(null);
    try {
      const parsed = parseDataUrl(src);
      const bounds = await detectFace(parsed.base64, parsed.mime, {
        apiKey: visionCred.apiKey || undefined,
        baseUrl: visionCred.baseUrl || undefined,
      });
      setViewerClipRegions(computeClipRegions(bounds.faceTop, bounds.faceBottom));
    } catch (err) {
      setDetectFaceError(err instanceof Error ? err.message : '人脸检测失败');
    }
  };

  const run = async (id: YinghuaStyleId) => {
    if (!uploadedImage) {
      showError('请先上传角色正面图片');
      return;
    }
    setYinghuaSlot(id, { status: 'loading', error: undefined });
    try {
      const images = await generate(buildRequest(yinghuaPrompts[id], { size: YINGHUA_SIZE }));
      setYinghuaSlot(id, { status: 'done', images });
      if (id === 1 && images[0]) void runFaceDetect(images[0]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setYinghuaSlot(id, { status: 'error', error: msg });
      showError(msg);
    }
  };

  return (
    <section className="glass p-6">
      <SectionHeader step="04" title="影画动作设计 · 三风格" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {YINGHUA_STYLES.map((style) => (
          <div
            key={style.id}
            className="flex flex-col rounded-xl border border-zzz-text/10 bg-zzz-text/[0.03] p-3"
          >
            <h3 className="font-mono text-sm font-bold text-zzz-magenta">{style.label}</h3>
            <p className="mb-2 mt-1 text-xs leading-relaxed text-zzz-text/55">{style.description}</p>
            <textarea
              value={yinghuaPrompts[style.id]}
              onChange={(e) => setYinghuaPrompt(style.id, e.target.value)}
              rows={5}
              className="glass-input w-full flex-1 resize-y px-2 py-2 text-xs leading-relaxed"
            />
            <button
              onClick={() => void run(style.id)}
              disabled={yinghuaSlots[style.id].status === 'loading'}
              className="glass-btn mt-2 py-2 font-mono text-xs uppercase tracking-widest text-zzz-text"
            >
              生成
            </button>
            <ResultView
              slot={yinghuaSlots[style.id]}
              downloadPrefix={`yinghua-style${style.id}`}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
