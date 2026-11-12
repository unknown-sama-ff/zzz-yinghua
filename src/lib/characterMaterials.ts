import type { GenRequest, ProviderName } from '../types';
import { generate } from './apiClient';
import { buildCharacterBreakdownPrompt, buildNamedCharacterPrompt, requireCharacterName } from './characterBreakdown';
import { prepareCharacterReferenceInputs } from './characterReferenceInputs';
import { sameImages } from './characterOriginals';
import { useCharacterSheetStore } from '../store/useCharacterSheetStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useUploadStore } from '../store/useUploadStore';
import { useIdentityStore } from '../store/useIdentityStore';
import { refreshUploadPalette } from './uploadTheme';
import { YINGHUA_SIZE } from './prompts';

export interface CharacterMaterialsInput {
  name: string;
  originals: string[];
  threeViewPrompt: string;
  breakdownTemplate: string;
  provider: ProviderName;
  model: string;
}

export interface CharacterMaterialsJob {
  input: CharacterMaterialsInput;
  phase: 'three-view' | 'breakdown';
  status: 'loading' | 'done' | 'error';
  threeViewImage?: string;
  error?: string;
}

export type CharacterRequestBuilder = (prompt: string, options: {
  imageOverride: string; refImages?: { base64: string; mime: string }[]; size: string;
}) => GenRequest;

export function canReuseMaterialThreeView(previous: CharacterMaterialsJob | null, input: CharacterMaterialsInput): boolean {
  return Boolean(previous?.status === 'error' && previous.phase === 'breakdown' && previous.threeViewImage
    && previous.input.name === input.name && sameImages(previous.input.originals, input.originals)
    && previous.input.threeViewPrompt === input.threeViewPrompt && previous.input.provider === input.provider
    && previous.input.model === input.model);
}

export async function generateCharacterBreakdown(input: {
  source: string; originals: string[]; name: string; template: string; provider: ProviderName; model: string;
}, buildRequest: CharacterRequestBuilder): Promise<string[]> {
  const name = requireCharacterName(input.name);
  const store = useCharacterSheetStore.getState();
  const current = store.sheets[input.source];
  if (current?.uploading || current?.slot.status === 'loading') throw new Error('这张角色素材正在处理中，请稍后重试');
  store.setSlot(input.source, { status: 'loading', error: undefined });
  try {
    const prompt = buildCharacterBreakdownPrompt(input.template, name);
    const inputs = await prepareCharacterReferenceInputs({ originals: input.originals, threeView: input.source, provider: input.provider, model: input.model });
    const images = await generate(buildRequest(prompt, { ...inputs, size: input.provider === 'seedream' ? '2848x1600' : YINGHUA_SIZE }));
    if (!images.length) throw new Error('未返回角色拆解图，请重试');
    store.registerSources([input.source], name);
    store.addImages(input.source, images.map((url) => ({ url, characterName: name, prompt, provider: input.provider })));
    store.setSlot(input.source, { status: 'done', images });
    return images;
  } catch (error) {
    store.setSlot(input.source, { status: 'error', error: error instanceof Error ? error.message : '拆解图生成失败' });
    throw error;
  }
}

/** Exactly two deliberate generations; retries resume a completed three-view. */
export async function generateCharacterMaterials(input: CharacterMaterialsInput, buildRequest: CharacterRequestBuilder, includeBreakdown: boolean): Promise<void> {
  const workbench = useWorkbenchStore.getState();
  if (workbench.materialsJob?.status === 'loading' || workbench.threeViewSlot.status === 'loading') return;
  requireCharacterName(input.name);
  if (!input.originals.length) throw new Error('请先上传原始角色参考图');
  const selectedAtStart = useUploadStore.getState().uploadedImage;
  const viewsAtStart = workbench.threeViewUploads;
  const originalsAtStart = useCharacterSheetStore.getState().originalsBySource[selectedAtStart ?? ''];
  const canReuse = includeBreakdown && canReuseMaterialThreeView(workbench.materialsJob, input);
  let threeView = canReuse ? workbench.materialsJob!.threeViewImage : undefined;
  let job: CharacterMaterialsJob = { input, phase: threeView ? 'breakdown' : 'three-view', status: 'loading', threeViewImage: threeView };
  workbench.setMaterialsJob(job);
  try {
    if (!threeView) {
      workbench.setThreeViewSlot({ status: 'loading', error: undefined });
      const inputs = await prepareCharacterReferenceInputs({ originals: input.originals, provider: input.provider, model: input.model });
      const prompt = buildNamedCharacterPrompt(input.threeViewPrompt, input.name);
      const images = await generate(buildRequest(prompt, { ...inputs, size: input.provider === 'seedream' ? '2848x1600' : YINGHUA_SIZE }));
      if (!images[0]) throw new Error('未返回角色三视图，请重试');
      threeView = images[0];
      const sheets = useCharacterSheetStore.getState();
      sheets.registerSources(images, input.name);
      sheets.setOriginals(images, input.originals);
      workbench.setThreeViewSlot({ status: 'done', images });
      workbench.addCostumeChangeImages(images);
      job = { ...job, threeViewImage: threeView };
    }
    if (includeBreakdown) {
      job = { ...job, phase: 'breakdown' };
      workbench.setMaterialsJob({ ...job });
      if (useUploadStore.getState().uploadedImage === selectedAtStart && useIdentityStore.getState().characterName.trim() === input.name.trim()
        && useWorkbenchStore.getState().threeViewUploads === viewsAtStart
        && useCharacterSheetStore.getState().originalsBySource[selectedAtStart ?? ''] === originalsAtStart) {
        useUploadStore.getState().setUpload(threeView!, 'three-view.png');
        void refreshUploadPalette(threeView!).catch(() => {});
      }
      await generateCharacterBreakdown({ source: threeView!, originals: input.originals, name: input.name,
        template: input.breakdownTemplate, provider: input.provider, model: input.model }, buildRequest);
    }
    workbench.setMaterialsJob({ ...job, status: 'done' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '角色素材生成失败';
    if (job.phase === 'three-view') workbench.setThreeViewSlot({ status: 'error', error: message });
    workbench.setMaterialsJob({ ...job, status: 'error', error: message });
    throw error;
  }
}
