import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { useIdentityStore } from '../store/useIdentityStore';
import { useProviderStore } from '../store/useProviderStore';
import { useUploadStore } from '../store/useUploadStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import { useViewerStore } from '../store/useViewerStore';
import { useToast } from '../store/useToast';
import { generate, ApiError } from '../lib/apiClient';
import { YINGHUA_STYLES, YINGHUA_SIZE, fillName, buildZeroFateDraftPrompt, buildZeroFateRenderPrompt } from '../lib/prompts';
import { stitchImages, embedThumbnails, extractFrontViewStructureAnchor } from '../lib/imageWorkerPool';
import type { ThumbEntry } from '../lib/imageWorkerPool';
import { loadStyleReferenceImages, preloadStyleReferenceImages } from '../lib/styleReferences';
import { maxReferenceImagesForModel, supportsMultipleImageInputs } from '../lib/gptImageCapabilities';
import { parseDataUrl, validateImageFile, fileToDataUrl, compressDataUrl } from '../lib/validation';
import { SIX_FATE_EDIT_MAX_DIM, ZERO_FATE_INPUT_MAX_DIM } from '../lib/constants';
import { isCurrentZeroFateDraft } from '../lib/zeroFate';
import { prepareZeroFateInputs } from '../lib/zeroFateInputs';
import { detectFace } from '../lib/detectFace';
import { computeClipRegions } from '../lib/clipRegions';
import { resolveYinghuaFaceImage } from '../lib/yinghuaFace';
import { useBuildRequest } from './useBuildRequest';
import { useInpaintStore } from '../store/useInpaintStore';
import { ResultView } from './ResultView';
import { SectionHeader } from './SectionHeader';
import { ZeroFateControls } from './ZeroFateControls';
import { GenerationErrorNotice } from './GenerationErrorNotice';
import { YinghuaStagePreview } from './YinghuaStagePreview';
import '../styles/yinghua-workflow.css';
import type { GallerySaveInfo } from './GallerySaveButton';
import type { GenSlot, InpaintTarget, UpstreamErrorDetails, YinghuaStyleId, ZeroFateMode } from '../types';

// ---------------------------------------------------------------------------
// One current stage keeps generation controls beside its preview.
// ---------------------------------------------------------------------------
const StyleCard = memo(function StyleCard({
  style,
  prompt,
  slot,
  characterName,
  provider,
  yinghuaSlots,
  activeGeneration,
  style3Face,
  onRun,
  onPromptChange,
  onInpaintClick,
  onFlipStyle3,
  zeroFateMode,
  draftReady,
  onGenerateDraft,
  showDraft,
  onConfirmDraft,
  onResetDraftPrompt,
  onGoToDraft,
  onNextStep,
}: {
  style: { id: YinghuaStyleId; label: string; description: string };
  prompt: string;
  slot: GenSlot;
  characterName: string;
  provider: string;
  yinghuaSlots: Record<YinghuaStyleId, GenSlot>;
  activeGeneration: { id: YinghuaStyleId; phase?: 'draft' | 'render' } | null;
  style3Face: 'front' | 'back';
  onRun: (id: YinghuaStyleId) => void;
  onPromptChange: (styleId: YinghuaStyleId, value: string) => void;
  onInpaintClick: (src: string, target: InpaintTarget) => void;
  onFlipStyle3: () => void;
  zeroFateMode: ZeroFateMode;
  draftReady: boolean;
  onGenerateDraft: () => void;
  showDraft: boolean;
  onConfirmDraft: () => void;
  onResetDraftPrompt: () => void;
  onGoToDraft: () => void;
  onNextStep: () => void;
}) {
  const zeroReady = yinghuaSlots[1].status === 'done' && Boolean(yinghuaSlots[1].images[0]);
  const threeReady = yinghuaSlots[2].status === 'done' && Boolean(yinghuaSlots[2].images[0]);
  // 六命阳是否存在必须只看正面图本身：阴面失败会把共享 slot 标为 error，
  // 但绝不能让已完成的阳图失去后续生成资格。
  const frontReady = Boolean(yinghuaSlots[3].images[0]);
  // 链路：零命→三命→六命
  const needsBase = style.id === 2
    ? !zeroReady
    : style.id === 3
      ? !threeReady
      : false;
  // 反面需要正面已完成
  const backNeedsFront = style.id === 3 && style3Face === 'back' && !frontReady;

  // 反面模式：背景与标题/报错颜色互换
  const isBack = style.id === 3 && style3Face === 'back';
  const displayedSixImage = style.id === 3
    ? resolveYinghuaFaceImage(slot.images, style3Face)
    : undefined;

  const displayedSlot = style.id === 3
    ? {
        ...slot,
        status: displayedSixImage ? 'done' : slot.status,
        images: displayedSixImage ? [displayedSixImage.src] : [],
      }
    : slot;
  const displayedImage = style.id === 3 ? displayedSixImage?.src : slot.images[0];
  const isActiveGeneration = activeGeneration?.id === style.id;
  const needsDraft = style.id === 1 && zeroFateMode === 'two-stage' && !draftReady;
  const generateLabel = backNeedsFront
    ? '需先生成六命阳'
    : needsBase
      ? (style.id === 2 ? '需先生成零命' : '需先生成三命')
      : isActiveGeneration
        ? (activeGeneration.phase === 'draft' ? '生成动作底稿中…' : '生成中…')
        : style.id === 1 && zeroFateMode === 'two-stage'
          ? (draftReady ? (slot.status === 'error' ? '重试零命转换（沿用底稿）' : '生成零命剪影') : '需先确认动作底稿')
          : style.id === 1 ? '生成零命' : style.id === 2 ? '生成三命' : style3Face === 'front' ? '生成六命阳' : '生成六命阴';

  // --- Card flip animation for style 3 (六命) ---
  const prevFaceRef = useRef(style3Face);
  const isFirstRender = useRef(true);
  const [cardFlipping, setCardFlipping] = useState(false);

  useEffect(() => {
    if (style.id !== 3) return;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevFaceRef.current = style3Face;
      return;
    }
    if (prevFaceRef.current !== style3Face) {
      prevFaceRef.current = style3Face;
      setCardFlipping(true);
      const timer = setTimeout(() => setCardFlipping(false), 460);
      return () => clearTimeout(timer);
    }
  }, [style3Face, style.id]);

  if (showDraft) return <ZeroFateControls isCurrent={draftReady} onGenerateDraft={onGenerateDraft} onConfirmDraft={onConfirmDraft} onResetPrompt={onResetDraftPrompt} onInpaintClick={onInpaintClick} />;
  const title = style.id === 1 ? '零命剪影' : style.id === 2 ? '三命灰阶' : style3Face === 'front' ? '六命全彩 · 阳' : '六命全彩 · 阴';
  const description = style.id === 1
    ? '沿用确认的动作与镜头，转为深色剪影，再添加角色文字。'
    : style.id === 2 ? '在零命构图上转换中性灰阶与点缀色，保持动作和文字位置。'
      : style3Face === 'front' ? '从三命恢复原角色的完整配色，保持镜头、衣装与图层对齐。' : '基于已完成的六命阳调整衣装表现，保持原有镜头与动作。';
  const resultSlot = displayedImage ? { ...displayedSlot, status: 'done' as const, images: [displayedImage] } : displayedSlot;
  return (
    <div className={`yinghua-stage${isBack ? ' yinghua-stage-yin' : ''}${style.id === 3 && cardFlipping ? ' fx-face-flip' : ''}`} data-yinghua-stage={style.id}>
      <div className="yinghua-stage-controls">
        <p className="yinghua-stage-eyebrow">{style.id === 1 ? '剪影与文字 / SILHOUETTE' : style.id === 2 ? '灰阶与点缀 / GRAYSCALE' : '原色与细节 / FULL COLOR'}</p>
        <div className="yinghua-stage-title">
          <h3>{title}</h3>
          {style.id === 3 && <button type="button" onClick={onFlipStyle3} className="glass-btn" aria-label={style3Face === 'front' ? '切换到六命阴' : '切换到六命阳'} aria-pressed={style3Face === 'back'}>{style3Face === 'front' ? '↻ 阳' : '↻ 阴'}</button>}
        </div>
        <p className="yinghua-stage-description">{description}</p>
        <details className="yinghua-prompt-editor">
          <summary>编辑{style.id === 1 ? '零命' : style.id === 2 ? '三命' : '六命'}提示词 <span aria-hidden="true">＋</span></summary>
          <textarea aria-label={`${style.label}提示词`} value={prompt} onChange={(e) => onPromptChange(style.id, e.target.value)} rows={10} className="glass-input" />
        </details>
        <GenerationErrorNotice message={slot.error} upstreamError={slot.upstreamError} />
        {needsDraft && <p className="yinghua-stage-note">先完成动作底稿并检查结构，再进入零命转换。</p>}
        <div className="yinghua-stage-actions">
          <button type="button" onClick={() => onRun(style.id)} disabled={Boolean(activeGeneration) || needsBase || backNeedsFront || needsDraft} className="yinghua-primary-action">{generateLabel}<span aria-hidden="true">↗</span></button>
          {style.id === 1 && zeroFateMode === 'two-stage' && <button type="button" onClick={onGoToDraft} className="yinghua-text-button">返回动作底稿</button>}
          {displayedImage && style.id < 3 && <button type="button" onClick={onNextStep} className="yinghua-text-button">下一步：{style.id === 1 ? '三命灰阶' : '六命全彩'} →</button>}
          <p>{style.id === 1 ? '转换失败时会保留动作底稿，可单独重试本步。' : style.id === 2 ? '需要已完成的零命图片作为底图。' : '阳面完成后，可切换到阴面继续创作。'}</p>
        </div>
      </div>
      <YinghuaStagePreview slot={displayedSlot} title={title} hint="预览、下载或继续修改当前结果；切换步骤会保留已生成的图片。">
        <ResultView slot={resultSlot} downloadPrefix={`yinghua-style${style.id}`}
          saveInfo={displayedImage ? ({ imageUrl: displayedImage, style: style.label, characterName, prompt, provider } satisfies GallerySaveInfo) : undefined}
          imageClassName={style.id === 3 && displayedSixImage ? 'fx-face-flip' : undefined}
          onInpaintClick={onInpaintClick}
          inpaintMeta={{ type: 'yinghua', slotId: style.id, ...(style.id === 3 ? { index: displayedSixImage?.index } : {}) }} />
      </YinghuaStagePreview>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------
export const YinghuaPanel = memo(function YinghuaPanel() {
  // Per-field selectors so this component only re-renders on fields it reads.
  const characterName = useIdentityStore((s) => s.characterName);
  const yinghuaPrompts = useYinghuaStore((s) => s.yinghuaPrompts);
  const setYinghuaPrompt = useYinghuaStore((s) => s.setYinghuaPrompt);
  const yinghuaSlots = useYinghuaStore((s) => s.yinghuaSlots);
  const setYinghuaSlot = useYinghuaStore((s) => s.setYinghuaSlot);
  const activeGeneration = useYinghuaStore((s) => s.activeGeneration);
  const beginYinghuaGeneration = useYinghuaStore((s) => s.beginYinghuaGeneration);
  const endYinghuaGeneration = useYinghuaStore((s) => s.endYinghuaGeneration);
  const zeroFateMode = useYinghuaStore((s) => s.zeroFateMode);
  const setZeroFateMode = useYinghuaStore((s) => s.setZeroFateMode);
  const [activeStep, setActiveStep] = useState<'draft' | YinghuaStyleId>(() => zeroFateMode === 'two-stage' ? 'draft' : 1);
  const zeroFateDraft = useYinghuaStore((s) => s.zeroFateDraft);
  const zeroFateDraftPrompt = useYinghuaStore((s) => s.zeroFateDraftPrompt);
  const setZeroFateDraft = useYinghuaStore((s) => s.setZeroFateDraft);
  const yinghuaShowText = useYinghuaStore((s) => s.yinghuaShowText);
  const setYinghuaShowText = useYinghuaStore((s) => s.setYinghuaShowText);
  const yinghuaCharacterDynamic = useYinghuaStore((s) => s.yinghuaCharacterDynamic);
  const setYinghuaCharacterDynamic = useYinghuaStore((s) => s.setYinghuaCharacterDynamic);
  const yinghuaMicroDynamic = useYinghuaStore((s) => s.yinghuaMicroDynamic);
  const setYinghuaMicroDynamic = useYinghuaStore((s) => s.setYinghuaMicroDynamic);
  const yinghuaCharacterTraits = useYinghuaStore((s) => s.yinghuaCharacterTraits);
  const setYinghuaCharacterTraits = useYinghuaStore((s) => s.setYinghuaCharacterTraits);
  const yinghuaAddonImage = useYinghuaStore((s) => s.yinghuaAddonImage);
  const setYinghuaAddonImage = useYinghuaStore((s) => s.setYinghuaAddonImage);
  const yinghuaLang = useYinghuaStore((s) => s.yinghuaLang);
  const setYinghuaLang = useYinghuaStore((s) => s.setYinghuaLang);
  const style3Face = useYinghuaStore((s) => s.style3Face);
  const setStyle3Face = useYinghuaStore((s) => s.setStyle3Face);
  const uploadedImage = useUploadStore((s) => s.uploadedImage);
  const palette = useUploadStore((s) => s.palette);
  const provider = useProviderStore((s) => s.provider);
  const freeloadEnabled = useProviderStore((s) => s.freeloadEnabled);
  const creds = useProviderStore((s) => s.creds);
  const visionCred = useProviderStore((s) => s.visionCred);
  const setViewerClipRegions = useViewerStore((s) => s.setViewerClipRegions);
  const setDetectFaceError = useViewerStore((s) => s.setDetectFaceError);
  const setFaceBounds = useViewerStore((s) => s.setFaceBounds);
  const showError = useToast((s) => s.show);
  const buildRequest = useBuildRequest();

  const zeroPromptOptions = useMemo(() => ({
    name: characterName, palette: palette ?? undefined, showText: yinghuaShowText,
    characterDynamic: yinghuaCharacterDynamic, microDynamic: yinghuaMicroDynamic,
    characterTraits: yinghuaCharacterTraits, lang: yinghuaLang,
  }), [characterName, palette, yinghuaShowText, yinghuaCharacterDynamic, yinghuaMicroDynamic, yinghuaCharacterTraits, yinghuaLang]);
  const computedDraftPrompt = useMemo(() => buildZeroFateDraftPrompt(zeroPromptOptions), [zeroPromptOptions]);
  useEffect(() => {
    useYinghuaStore.getState().setZeroFateDraftPrompt(computedDraftPrompt);
  }, [computedDraftPrompt]);
  const draftContext = { sourceImage: uploadedImage ?? '', addonImage: yinghuaAddonImage, prompt: zeroFateDraftPrompt };
  const draftReady = isCurrentZeroFateDraft(zeroFateDraft, draftContext);

  // Compute prompts once from all inputs, then write to store in one effect.
  const computedPrompts = useMemo(() => {
    const prompts: Record<number, string> = {};
    for (const style of YINGHUA_STYLES) {
      if (style.id === 1 && zeroFateMode === 'two-stage') {
        prompts[1] = buildZeroFateRenderPrompt(zeroPromptOptions);
      } else if (style.id === 3 && style.promptTemplateFront && style.promptTemplateBack) {
        const tmpl =
          style3Face === 'front'
            ? (yinghuaLang === 'en' && style.promptTemplateFrontEn
                ? style.promptTemplateFrontEn
                : style.promptTemplateFront)
            : (yinghuaLang === 'en' && style.promptTemplateBackEn
                ? style.promptTemplateBackEn
                : style.promptTemplateBack);
        prompts[style.id] = fillName(
          tmpl,
          characterName, palette ?? undefined, yinghuaShowText,
          yinghuaCharacterDynamic, yinghuaMicroDynamic,
          yinghuaCharacterTraits, yinghuaLang, style.id,
        );
      } else {
        prompts[style.id] = fillName(
          yinghuaLang === 'en' && style.promptTemplateEn ? style.promptTemplateEn : style.promptTemplate,
          characterName, palette ?? undefined, yinghuaShowText,
          yinghuaCharacterDynamic, yinghuaMicroDynamic,
          yinghuaCharacterTraits, yinghuaLang, style.id,
        );
      }
    }
    return prompts;
  }, [characterName, palette, yinghuaShowText, yinghuaCharacterDynamic,
      yinghuaMicroDynamic, yinghuaCharacterTraits, yinghuaLang, style3Face, zeroFateMode, zeroPromptOptions]);

  useEffect(() => {
    for (const [id, prompt] of Object.entries(computedPrompts)) {
      setYinghuaPrompt(Number(id) as YinghuaStyleId, prompt);
    }
  }, [computedPrompts, setYinghuaPrompt]);

  // Warm the style reference sheets on mount.
  useEffect(() => {
    void preloadStyleReferenceImages();
  }, []);

  const runFaceDetect = async (src: string) => {
    setDetectFaceError(null);
    try {
      let dataUrl = src;
      if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      const parsed = parseDataUrl(dataUrl);
      const bounds = await detectFace(parsed.base64, parsed.mime, freeloadEnabled
        ? { useServerPreset: true }
        : {
            apiKey: visionCred.apiKey || undefined,
            baseUrl: visionCred.baseUrl || undefined,
            model: visionCred.model || undefined,
          });
      setViewerClipRegions(computeClipRegions(bounds.faceTop, bounds.faceBottom, bounds.bodyAxisAngle));
      setFaceBounds(bounds);
    } catch (err) {
      setDetectFaceError(err instanceof Error ? err.message : '人脸检测失败');
    }
  };

  const run = async (id: YinghuaStyleId, regenerateDraft = false) => {
    if (!uploadedImage) {
      showError('请先上传角色正面图片');
      return;
    }
    if (!freeloadEnabled) {
      const cred = creds[provider];
      if (!cred.apiKey.trim()) {
        showError('请先在「工坊设置 → 接口与模型」填写 API Key');
        return;
      }
      if (!cred.baseUrl.trim()) {
        showError('请先在「工坊设置 → 接口与模型」填写 Base URL');
        return;
      }
    }
    // 六命反面需要先有正面
    if (id === 3 && style3Face === 'back' && !yinghuaSlots[3].images[0]) {
      showError('请先生成六命阳，再生成六命阴');
      return;
    }
    const phase = id === 1 && zeroFateMode === 'two-stage'
      ? (regenerateDraft || !draftReady ? 'draft' : 'render')
      : undefined;
    const generation = beginYinghuaGeneration(id, phase);
    if (!generation) return;

    const { idempotencyKey } = generation;
    const selectedFace = style3Face;
    const prompt = phase === 'draft' ? zeroFateDraftPrompt : yinghuaPrompts[id];
    const sourceImage = uploadedImage;
    const addonImage = yinghuaAddonImage;
    const sourceSlots = yinghuaSlots;
    // 模块 02 的上传三视图是整条影画链路的角色原始参考；它通常来自
    // 模块 01 的“用作主立绘”，也可由用户直接上传。不要使用服装改造历史。
    const identityReference = sourceImage;
    const selectedProvider = provider;
    const selectedDraftImage = zeroFateDraft.images[0];
    const selectedDraftContext = { sourceImage, addonImage, prompt: zeroFateDraftPrompt };

    const setGenerationError = (message: string, upstreamError?: UpstreamErrorDetails) => {
      if (phase === 'draft') setZeroFateDraft({ status: 'error', error: message, upstreamError });
      else setYinghuaSlot(id, { status: 'error', error: message, upstreamError });
    };

    let imageOverride: string | undefined;
    let refImages: { base64: string; mime: string }[] | undefined;
    try {
      if (phase) {
        const inputs = await prepareZeroFateInputs({
          phase, sourceImage, addonImage, draftImage: selectedDraftImage,
          provider: selectedProvider, model: creds[selectedProvider].model,
        });
        imageOverride = inputs.imageOverride;
        refImages = inputs.refImages;
      } else if (id === 1) {
        const styleReferences = await loadStyleReferenceImages(id);
        const selectedModel = creds[selectedProvider].model;
        if (supportsMultipleImageInputs(selectedProvider, selectedModel)) {
          const referenceDataUrls = [addonImage, ...styleReferences].filter((url): url is string => Boolean(url));
          const maxReferences = maxReferenceImagesForModel(selectedProvider, selectedModel);
          if (referenceDataUrls.length > maxReferences) {
            throw new Error(`当前模型最多支持 ${maxReferences} 张额外参考图`);
          }
          imageOverride = sourceImage;
          refImages = referenceDataUrls.map((url) => {
            const parsed = parseDataUrl(url);
            return { base64: parsed.base64, mime: parsed.mime };
          });
        } else {
          const styleSheet = await stitchImages(styleReferences);
          imageOverride = await stitchImages([sourceImage, addonImage, styleSheet]);
        }
      } else {
        const baseImg = id === 3
          ? (selectedFace === 'back' ? sourceSlots[3].images[0] : sourceSlots[2].images[0])
          : sourceSlots[1].images[0];
        if (!baseImg) {
          showError(id === 3
            ? '请先生成三命，六命以三命成图为底图'
            : '请先生成零命，三命需要零命结果锁定姿势与文字位置');
          return;
        }
        const threeView = identityReference;
        if (id === 3 && selectedFace === 'front' && !threeView) {
          showError('请先在「角色素材」生成或上传三视图，再生成六命阳');
          return;
        }
        // A conventional horizontal three-view has the full front view at the
        // left. Give six-fate a separate crop for anatomy without duplicating
        // the canonical full-color identity image.
        const structureAnchor = id === 3 && threeView
          ? await extractFrontViewStructureAnchor(threeView)
          : null;
        // Keep semantic priority stable for GPT edits: base composition first,
        // canonical color/identity three-view second, front anatomy anchor
        // third when available, optional prop last.
        const references = [threeView, structureAnchor, addonImage]
          .filter((url): url is string => Boolean(url))
          .filter((url, index, all) => all.indexOf(url) === index);
        const selectedModel = creds[selectedProvider].model;
        if (supportsMultipleImageInputs(selectedProvider, selectedModel)) {
          const maxReferences = maxReferenceImagesForModel(selectedProvider, selectedModel);
          if (references.length > maxReferences) {
            throw new Error(`当前模型最多支持 ${maxReferences} 张额外参考图`);
          }
          imageOverride = baseImg;
          refImages = await Promise.all(references.map(async (url) => {
            let dataUrl = url;
            if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
              const res = await fetch(dataUrl);
              const blob = await res.blob();
              dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            }
            const parsed = parseDataUrl(dataUrl);
            return { base64: parsed.base64, mime: parsed.mime };
          }));
        } else {
          const thumbs: ThumbEntry[] = [];
          if (threeView) {
            thumbs.push({ url: threeView, size: 0.2, position: 'bottom-right' });
          }
          if (structureAnchor) {
            thumbs.push({ url: structureAnchor, size: 0.18, position: 'bottom-right' });
          }
          if (addonImage && addonImage !== threeView && addonImage !== structureAnchor) {
            thumbs.push({ url: addonImage, size: 0.18, position: 'bottom-left' });
          }
          imageOverride = thumbs.length > 0
            ? await embedThumbnails(baseImg, thumbs)
            : baseImg;
        }
      }

      if (selectedProvider === 'gpt-image' && imageOverride && !phase) {
        let src = imageOverride;
        if (src.startsWith('http://') || src.startsWith('https://')) {
          const res = await fetch(src);
          const blob = await res.blob();
          src = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }
        imageOverride = await compressDataUrl(
          src,
          id === 3 && selectedFace === 'front' ? SIX_FATE_EDIT_MAX_DIM : 1024,
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '风格参考图准备失败';
      setGenerationError(msg, err instanceof ApiError ? err.upstreamError : undefined);
      showError(msg);
      endYinghuaGeneration(idempotencyKey);
      return;
    }

    try {
      const isSixFateFront = id === 3 && selectedFace === 'front';
      const sizeOpts = selectedProvider === 'seedream'
        ? { size: '2848x1600', imageOverride, refImages }
        : {
            size: YINGHUA_SIZE,
            imageOverride,
            refImages,
            ...(phase ? { inputImageMaxDimension: ZERO_FATE_INPUT_MAX_DIM }
              : isSixFateFront ? { inputImageMaxDimension: SIX_FATE_EDIT_MAX_DIM } : {}),
          };
      const images = await generate({
        ...buildRequest(prompt, sizeOpts),
        idempotencyKey,
      });

      if (!images[0]) throw new Error('生成未返回图片，请重试');
      if (phase) {
        const current = useYinghuaStore.getState();
        const contextNow = {
          sourceImage: useUploadStore.getState().uploadedImage ?? '',
          addonImage: current.yinghuaAddonImage,
          prompt: current.zeroFateDraftPrompt,
        };
        const draftToCheck = phase === 'draft'
          ? { status: 'done' as const, images, context: selectedDraftContext }
          : current.zeroFateDraft;
        if (!isCurrentZeroFateDraft(draftToCheck, contextNow)
          || (phase === 'render' && current.zeroFateDraft.images[0] !== selectedDraftImage)) {
          // Keep an outdated draft available for inspection, but never
          // silently promote an old character/pose to the current workflow.
          if (phase === 'draft') setZeroFateDraft({ images, context: selectedDraftContext });
          throw new Error('生成期间角色或动作输入已更新，请检查结果并重新生成当前底稿');
        }
        if (phase === 'draft') {
          setZeroFateDraft({ status: 'done', images: [images[0]], context: selectedDraftContext, error: undefined });
          return;
        }
      }

      // 六命：正面存 images[0]，反面存 images[1]，不互相覆盖
      if (id === 3) {
        const existing = useYinghuaStore.getState().yinghuaSlots[3].images;
        const newImages = [...existing];
        newImages[selectedFace === 'front' ? 0 : 1] = images[0];
        setYinghuaSlot(id, { status: 'done', images: newImages });
      } else if (id === 1) {
        useYinghuaStore.getState().completeZeroFate(images);
        setViewerClipRegions(null);
        setFaceBounds(null);
      } else {
        setYinghuaSlot(id, { status: 'done', images });
      }
      await Promise.resolve();

      const capturedImages = images;
      const shouldAutoDetectFace = id === 3 && selectedFace === 'front';
      setTimeout(() => {
        if (shouldAutoDetectFace && capturedImages[0]) {
          void runFaceDetect(capturedImages[0]);
        }
      }, 0);
    } catch (err) {
      const msg = err instanceof ApiError || err instanceof Error ? err.message : '生成失败';
      setGenerationError(msg, err instanceof ApiError ? err.upstreamError : undefined);
      showError(msg);
    } finally {
      endYinghuaGeneration(idempotencyKey);
    }
  };

  const handlePromptChange = useCallback((styleId: YinghuaStyleId, value: string) => {
    setYinghuaPrompt(styleId, value);
  }, [setYinghuaPrompt]);

  const handleInpaintClick = useCallback((src: string, target: InpaintTarget) => {
    const openWorkspace = useInpaintStore.getState().openWorkspace;
    openWorkspace({ ...target, url: src });
  }, []);

  const steps: { id: 'draft' | YinghuaStyleId; title: string; detail: string }[] = [
    ...(zeroFateMode === 'two-stage' ? [{ id: 'draft' as const, title: '动作底稿', detail: '检查结构' }] : []),
    { id: 1, title: '零命剪影', detail: '明暗与文字' },
    { id: 2, title: '三命灰阶', detail: '灰阶与点缀' },
    { id: 3, title: '六命全彩', detail: '原色与细节' },
  ];
  const selectedStyle = YINGHUA_STYLES.find((style) => style.id === (activeStep === 'draft' ? 1 : activeStep))!;

  return (
    <section className="glass p-6 yinghua-workflow" data-inpaint-zone="yinghua">
      <div className="yinghua-workflow-heading">
        <div><SectionHeader title="影画动作设计" /><p>从动作结构开始，逐步完成角色影画。</p></div>
        <div className="yinghua-toolbar">
          <button type="button" onClick={() => setYinghuaShowText(!yinghuaShowText)} aria-pressed={yinghuaShowText} className="glass-btn">{yinghuaShowText ? '文字：开' : '文字：关'}</button>
          <button type="button" onClick={() => setYinghuaLang(yinghuaLang === 'zh' ? 'en' : 'zh')} className="glass-btn">{yinghuaLang === 'zh' ? '中 → EN' : 'EN → 中'}</button>
        </div>
      </div>
      <details className="yinghua-settings">
        <summary>动作与角色设置 <span>动作、表情、角色特点与附加参考</span><b aria-hidden="true">＋</b></summary>
        <div className="yinghua-settings-grid">
          <label>角色动态<input type="text" aria-label="角色动态" value={yinghuaCharacterDynamic} onChange={(e) => setYinghuaCharacterDynamic(e.target.value)} className="glass-input" /></label>
          <label>微动态细节<input type="text" aria-label="微动态细节" value={yinghuaMicroDynamic} onChange={(e) => setYinghuaMicroDynamic(e.target.value)} className="glass-input" /></label>
          <label>角色特点<input type="text" aria-label="角色特点" value={yinghuaCharacterTraits} onChange={(e) => setYinghuaCharacterTraits(e.target.value)} placeholder="性格、特性等（可选）" className="glass-input" /></label>
          <div className="yinghua-addon">
            <span>附加参考</span>
            {yinghuaAddonImage ? <div className="yinghua-addon-preview">
              <img src={yinghuaAddonImage} alt="附加元素" />
              <button type="button" onClick={() => setYinghuaAddonImage(null)} className="glass-btn">移除参考图</button>
            </div> : <label className="glass-input">上传武器或道具参考
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const check = validateImageFile(file);
                if (!check.ok) { showError(check.message ?? '文件校验失败'); return; }
                setYinghuaAddonImage(await fileToDataUrl(file));
                e.target.value = '';
              }} />
            </label>}
          </div>
        </div>
      </details>
      <div className="yinghua-mode-row">
        <div role="group" aria-label="零命生成模式" className="yinghua-mode-switch">
          {(['two-stage', 'direct'] as const).map((mode) => <button type="button" key={mode} disabled={Boolean(activeGeneration)} aria-pressed={zeroFateMode === mode} onClick={() => { setZeroFateMode(mode); setActiveStep(mode === 'two-stage' ? 'draft' : 1); }}>{mode === 'two-stage' ? '两阶段生成' : '直接生成'}</button>)}
        </div>
        <p>{zeroFateMode === 'two-stage' ? '底稿确认后再转换，每一步可单独重试。' : '直接生成零命剪影，沿用原有生成方式。'}</p>
      </div>
      <p className="yinghua-mode-notice" role="note">两阶段生成可能收到上游内容审核拒绝。若需要一步生成零命剪影，也可主动选择“直接生成”；两种模式均须通过内容审核。</p>
      <nav className="yinghua-step-navigation" aria-label="影画制作步骤">
        {steps.map((step, index) => {
          const done = step.id === 'draft' ? draftReady : Boolean(yinghuaSlots[step.id].images[0]);
          const loading = activeGeneration && (step.id === 'draft' ? activeGeneration.phase === 'draft' : activeGeneration.id === step.id && activeGeneration.phase !== 'draft');
          return <button type="button" key={step.id} aria-current={activeStep === step.id ? 'step' : undefined} aria-controls="yinghua-current-stage" onClick={() => setActiveStep(step.id)}>
            <span className="yinghua-step-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="yinghua-step-copy"><strong>{step.title}</strong><small>{step.detail}</small></span>
            <span className="yinghua-step-state">{loading ? '生成中' : done ? '已就绪' : '待生成'}</span>
          </button>;
        })}
      </nav>
      <div id="yinghua-current-stage">
        <StyleCard key={activeStep} style={selectedStyle} prompt={yinghuaPrompts[selectedStyle.id]} slot={yinghuaSlots[selectedStyle.id]}
          characterName={characterName} provider={provider} yinghuaSlots={yinghuaSlots} activeGeneration={activeGeneration} style3Face={style3Face}
          onRun={run} onPromptChange={handlePromptChange} onInpaintClick={handleInpaintClick} onFlipStyle3={() => setStyle3Face(style3Face === 'front' ? 'back' : 'front')}
          zeroFateMode={zeroFateMode} draftReady={draftReady} showDraft={activeStep === 'draft'}
          onGenerateDraft={() => void run(1, true)} onConfirmDraft={() => { setActiveStep(1); void run(1); }}
          onResetDraftPrompt={() => useYinghuaStore.getState().setZeroFateDraftPrompt(computedDraftPrompt)}
          onGoToDraft={() => setActiveStep('draft')} onNextStep={() => setActiveStep(selectedStyle.id === 1 ? 2 : 3)} />
      </div>
      <p className="yinghua-workflow-footnote">新零命生成后，需重新生成三命和六命，确保查看器中的图层对齐。</p>
    </section>
  );
});
