import { inpaint, ApiError } from './apiClient';
import { buildContextualEditPrompt } from './inpaintPrompt';
import { useInpaintStore } from '../store/useInpaintStore';
import { gptImageQualityForRequest, useProviderStore } from '../store/useProviderStore';

export type ImageEditOutcome = { status: 'complete'; imageUrl: string } | { status: 'busy' | 'stale' };

/** Shared submit path for typed edits and explicit one-click repair actions. */
export async function submitImageEdit(options: {
  instruction: string;
  editMode?: 'smart' | 'precise';
  maskDataUrl?: string;
}): Promise<ImageEditOutcome> {
  const editor = useInpaintStore.getState();
  if (editor.isGenerating) return { status: 'busy' };
  const { currentVersionId, currentVersionUrl, targetImage } = editor;
  const rootId = editor.versions[0]?.id;
  if (!rootId || !targetImage || !currentVersionId || !currentVersionUrl) {
    throw new ApiError('INVALID_INPUT', '请先选择要修改的图片');
  }
  const instruction = options.instruction.trim();
  const editMode = options.editMode ?? editor.mode;
  const ownsSession = () => useInpaintStore.getState().versions[0]?.id === rootId;
  editor.setIsGenerating(true);
  editor.setGenerationError(null);
  try {
    if (!instruction) throw new ApiError('INVALID_INPUT', '请输入修改说明');
    if (editMode === 'precise' && !options.maskDataUrl) throw new ApiError('INVALID_INPUT', '请先在画布上涂抹要编辑的区域');
    const settings = useProviderStore.getState();
    const credentials = settings.creds['gpt-image'];
    if (!settings.freeloadEnabled && !credentials.apiKey.trim()) throw new ApiError('INVALID_INPUT', '请先在「工坊设置 → 接口与模型」填写 gpt-image API Key');
    if (!settings.freeloadEnabled && !credentials.baseUrl.trim()) throw new ApiError('INVALID_INPUT', '请先在「工坊设置 → 接口与模型」填写 gpt-image Base URL');
    const images = await inpaint({
      imageDataUrl: currentVersionUrl,
      maskDataUrl: options.maskDataUrl,
      prompt: buildContextualEditPrompt(instruction, editMode),
      provider: 'gpt-image',
      quality: gptImageQualityForRequest(settings),
      apiKey: credentials.apiKey.trim() || undefined,
      baseUrl: credentials.baseUrl.trim() || undefined,
      model: credentials.model.trim() || undefined,
      useServerPreset: settings.freeloadEnabled,
      editMode,
    });
    if (!ownsSession()) return { status: 'stale' };
    if (!images[0]) throw new ApiError('UPSTREAM_ERROR', '编辑接口未返回图片，请重试');
    const version = useInpaintStore.getState().appendVersion(images[0], instruction, currentVersionId);
    if (!version) return { status: 'stale' };
    return { status: 'complete', imageUrl: version.url };
  } catch (error) {
    if (!ownsSession()) return { status: 'stale' };
    useInpaintStore.getState().setGenerationError({
      message: error instanceof Error ? error.message : '图片编辑失败',
      upstreamError: error instanceof ApiError ? error.upstreamError : undefined,
    });
    throw error;
  } finally {
    // Closing/reopening the editor creates a new root. An old request must not
    // clear a newer session's busy state or append to its version history.
    if (ownsSession()) useInpaintStore.getState().setIsGenerating(false);
  }
}
