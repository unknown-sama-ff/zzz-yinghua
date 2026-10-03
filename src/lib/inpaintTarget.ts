import { extractPalette } from './colorExtract';
import { applyTheme } from './theme';
import { useUploadStore } from '../store/useUploadStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import type { InpaintTarget, YinghuaStyleId } from '../types';

function normalizedSource(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  try { return new URL(src, window.location.href).href; } catch { return src; }
}
export function sameImageSource(left: string | undefined, right: string): boolean {
  return Boolean(left) && normalizedSource(left!) === normalizedSource(right);
}

export function canReplaceInpaintTarget(target: InpaintTarget): boolean {
  if (target.type === 'upload') return true;
  const validIndex = target.index !== undefined && Number.isInteger(target.index) && target.index >= 0;
  if (target.type === 'yinghua') {
    return validIndex && [1, 2, 3].includes(target.slotId ?? 0)
      && (target.slotId !== 3 || target.index! < 2);
  }
  return validIndex && ['poster', 'costume', 'three-view'].includes(target.type);
}

function currentTargetSource(target: InpaintTarget): string | undefined {
  if (!canReplaceInpaintTarget(target)) return undefined;
  switch (target.type) {
    case 'yinghua': return useYinghuaStore.getState().yinghuaSlots[target.slotId!].images[target.index!];
    case 'poster': return useWorkbenchStore.getState().posterSlot.images[target.index!];
    case 'costume': return useWorkbenchStore.getState().costumeChangeSlot.images[target.index!];
    case 'three-view': return useWorkbenchStore.getState().threeViewSlot.images[target.index!];
    case 'upload': return useUploadStore.getState().uploadedImage ?? undefined;
    default: return undefined;
  }
}

/** Prefer explicit slot ownership, including when two faces share a URL. */
export function resolveInpaintTarget(
  src: string,
  zone: string,
  location?: Omit<InpaintTarget, 'url'>,
): InpaintTarget {
  if (location) {
    const target = { ...location, url: src };
    if (sameImageSource(currentTargetSource(target), src)) return target;
    // A stale explicit location must not fall through to a different owner.
    return { url: src, type: 'preview' };
  }
  if (zone === 'yinghua') {
    const { yinghuaSlots } = useYinghuaStore.getState();
    for (const slotId of [1, 2, 3] as YinghuaStyleId[]) {
      const index = yinghuaSlots[slotId].images.findIndex((image) => sameImageSource(image, src));
      if (index >= 0) return { url: src, type: 'yinghua', slotId, index };
    }
  }
  const workbench = useWorkbenchStore.getState();
  const slot = zone === 'three-view' ? workbench.threeViewSlot
    : zone === 'poster' ? workbench.posterSlot : zone === 'costume' ? workbench.costumeChangeSlot : undefined;
  if (slot) {
    const index = slot.images.findIndex((image) => sameImageSource(image, src));
    if (index >= 0) return { url: src, type: zone as 'three-view' | 'poster' | 'costume', index };
  }
  if ((zone === 'costume' || zone === 'upload') && sameImageSource(useUploadStore.getState().uploadedImage ?? undefined, src)) {
    return { url: src, type: 'upload' };
  }
  return { url: src, type: 'preview' };
}

/** Resolve the actual displayed image, not a requested-but-missing Yin face. */
export function resolveInpaintElementTarget(image: HTMLImageElement): InpaintTarget {
  const zone = image.closest('[data-inpaint-zone]')?.getAttribute('data-inpaint-zone') ?? '';
  const type = image.getAttribute('data-inpaint-type');
  const index = image.getAttribute('data-inpaint-index');
  const slot = image.getAttribute('data-inpaint-slot-id');
  if (type === 'yinghua' || type === 'three-view' || type === 'poster' || type === 'costume' || type === 'upload') {
    return resolveInpaintTarget(image.src, zone, {
      type,
      ...(index !== null ? { index: Number(index) } : {}),
      ...(slot !== null && ['1', '2', '3'].includes(slot) ? { slotId: Number(slot) as YinghuaStyleId } : {}),
    });
  }
  // Unmarked images inside 04 are addon references, not writable results.
  if (zone === 'yinghua') return { url: image.src, type: 'preview' };
  return resolveInpaintTarget(image.src, zone);
}

export function inpaintTargetLabel(target: InpaintTarget): string {
  switch (target.type) {
    case 'yinghua':
      if (target.slotId === 1) return '零命图片';
      if (target.slotId === 2) return '三命图片';
      return target.index === 1 ? '六命阴图片' : '六命阳图片';
    case 'poster': return '海报图片';
    case 'costume': return '换装三视图';
    case 'three-view': return '三视图图片';
    case 'upload': return '模块 02 主立绘';
    default: return '当前预览图片';
  }
}

/** Atomic, local write-back: never generate, charge, or overwrite a newer slot. */
export async function replaceInpaintTarget(target: InpaintTarget, replacement: string): Promise<boolean> {
  if (!replacement || !sameImageSource(currentTargetSource(target), target.url)) return false;
  if (target.type === 'yinghua') {
    const store = useYinghuaStore.getState();
    const slotId = target.slotId!;
    if (store.yinghuaSlots[slotId].status === 'loading' || store.activeGeneration?.id === slotId) return false;
    const images = [...store.yinghuaSlots[slotId].images];
    images[target.index!] = replacement;
    store.setYinghuaSlot(slotId, { status: 'done', images, error: undefined });
    return true;
  }
  if (target.type === 'upload') {
    const store = useUploadStore.getState();
    store.setUpload(replacement, 'inpaint-result.png');
    try {
      const palette = await extractPalette(replacement);
      // Palette extraction must not override a later upload's theme.
      if (sameImageSource(useUploadStore.getState().uploadedImage ?? undefined, replacement)) {
        store.setPalette(palette);
        applyTheme(palette);
      }
    } catch { /* A valid replacement does not depend on palette extraction. */ }
    return true;
  }
  const store = useWorkbenchStore.getState();
  const slot = target.type === 'poster' ? store.posterSlot
    : target.type === 'costume' ? store.costumeChangeSlot : store.threeViewSlot;
  if (slot.status === 'loading') return false;
  const images = [...slot.images];
  images[target.index!] = replacement;
  if (target.type === 'poster') store.setPosterSlot({ status: 'done', images, error: undefined });
  else if (target.type === 'costume') store.setCostumeChangeSlot({ status: 'done', images, error: undefined });
  else store.setThreeViewSlot({ status: 'done', images, error: undefined });
  return true;
}
