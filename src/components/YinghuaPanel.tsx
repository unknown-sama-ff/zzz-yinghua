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
        model: visionCred.model || undefined,
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
    // Chain styles so the character stays in the same pose/position: 零命 (id=1)
    // generates from the main portrait; 三命/六命 take 零命's output as their
    // image-to-image input. Falls back to the main portrait if 零命 isn't ready.
    let imageOverride: string | undefined;
    if (id !== 1) {
      const baseImg = yinghuaSlots[1].images[0];
      if (!baseImg) {
        showError('请先生成零命，三命/六命会以零命结果为基准锁定姿势');
        return;
      }
      imageOverride = baseImg;
    }
    setYinghuaSlot(id, { status: 'loading', error: undefined });
    try {
      const images = await generate(
        buildRequest(yinghuaPrompts[id], { size: YINGHUA_SIZE, imageOverride }),
      );
      setYinghuaSlot(id, { status: 'done', images });
      // 六命是全彩完整图，脸部辨识度最高，优先用它做人脸检测
      if ((id === 3 || (id === 1 && !yinghuaSlots[3].images[0])) && images[0]) void runFaceDetect(images[0]);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : '生成失败';
      setYinghuaSlot(id, { status: 'error', error: msg });
      showError(msg);
    }
  };

  return (
    <section className="glass p-6">
      <SectionHeader step="04" title="影画动作设计 · 三风格" />
      <div className="-mt-2 mb-4 rounded-lg border border-zzz-text/10 bg-zzz-text/[0.02] p-3 font-mono text-[11px] leading-relaxed text-zzz-text/55">
        <p className="mb-1.5 text-zzz-primary/80">
          ⛓ 先生成「零命」，三命/六命会自动以零命结果为基准锁定角色姿势与位置，三张构图保持一致。
        </p>
        <p>
          默认不在图中生成文字（角色名由查看器自动叠加）。想在画面内生成文字的，把下方 prompt 里的
          <span className="mx-1 rounded bg-zzz-text/10 px-1 text-zzz-text/80">画面整洁不含任何文字</span>
          替换成下面这段（直接复制粘贴，把英文名改成你的角色名）：
        </p>
        <code className="mt-2 block select-all rounded bg-zzz-ink/50 px-2 py-1.5 text-zzz-primary/90">
          图片顶部左侧超大做旧印刷体英文「YINGHUA」，图片底部右侧超大做旧印刷体英文「WORKSHOP」，角色脸部清晰不被文字遮挡，底部一行小字星级副标题信息
        </code>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {YINGHUA_STYLES.map((style) => {
          const baseReady = yinghuaSlots[1].status === 'done' && Boolean(yinghuaSlots[1].images[0]);
          const needsBase = style.id !== 1 && !baseReady;
          return (
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
              disabled={yinghuaSlots[style.id].status === 'loading' || needsBase}
              className="glass-btn mt-2 py-2 font-mono text-xs uppercase tracking-widest text-zzz-text disabled:opacity-40"
            >
              {needsBase ? '需先生成零命' : '生成'}
            </button>
            <ResultView
              slot={yinghuaSlots[style.id]}
              downloadPrefix={`yinghua-style${style.id}`}
            />
          </div>
          );
        })}
      </div>
    </section>
  );
}
