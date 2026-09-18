import { extractPalette } from './colorExtract';
import { applyTheme } from './theme';
import { useUploadStore } from '../store/useUploadStore';
import { useWorkbenchStore } from '../store/useWorkbenchStore';
import { useYinghuaStore } from '../store/useYinghuaStore';
import type { InpaintTarget, YinghuaStyleId } from '../types';

function normalizedSource(src: string): string {
  if (src.startsWith('data:') || src.startsWith('blob:')) return src;
  try {
    return new URL(src, window.location.href).href;
  } catch {
    return src;
  }
}

export function sameImageSource(left: string | undefined, right: string): boolean {
  if (!left) return false;
  return normalizedSource(left) === normalizedSource(right);
}

function findImageIndex(images: string[], src: string): number {
  return images.findIndex((image) => sameImageSource(image, src));
}

/**
 * Resolve a portal-selected DOM image to its state owner. Images that are not
 * the current writable output remain usable as inpaint canvases, but are
 * deliberately marked preview-only so confirming an edit can never overwrite
 * an unrelated module image.
 */
export function resolveInpaintTarget(src: string, zone: string): InpaintTarget {
  if (zone === 'yinghua') {
    const { yinghuaSlots } = useYinghuaStore.getState();
    for (const styleId of [1, 2, 3] as YinghuaStyleId[]) {
      const index = findImageIndex(yinghuaSlots[styleId].images, src);
      if (index >= 0) return { url: src, type: 'yinghua', slotId: styleId, index };
    }
  }

  if (zone === 'three-view') {
    const index = findImageIndex(useWorkbenchStore.getState().threeViewSlot.images, src);
    if (index >= 0) return { url: src, type: 'three-view', index };
  }

  if (zone === 'poster') {
    const index = findImageIndex(useWorkbenchStore.getState().posterSlot.images, src);
    if (index >= 0) return { url: src, type: 'poster', index };
  }

  if (zone === 'costume') {
    const workbench = useWorkbenchStore.getState();
    const costumeIndex = findImageIndex(workbench.costumeChangeSlot.images, src);
    if (costumeIndex >= 0) return { url: src, type: 'costume', index: costumeIndex };

    if (sameImageSource(useUploadStore.getState().uploadedImage ?? undefined, src)) {
      return { url: src, type: 'upload' };
    }
  }

  if (zone === 'upload' && sameImageSource(useUploadStore.getState().uploadedImage ?? undefined, src)) {
    return { url: src, type: 'upload' };
  }

  return { url: src, type: 'preview' };
}

export function canReplaceInpaintTarget(target: InpaintTarget): boolean {
  return target.type !== 'preview';
}

export function inpaintTargetLabel(target: InpaintTarget): string {
  switch (target.type) {
    case 'yinghua':
      if (target.slotId === 1) return '零命图片';
      if (target.slotId === 2) return '三命图片';
      return target.index === 1 ? '六命阴图片' : '六命阳图片';
    case 'poster':
      return '海报图片';
    case 'costume':
      return '换装三视图';
    case 'three-view':
      return '三视图图片';
    case 'upload':
      return '模块 02 主立绘';
    default:
      return '当前预览图片';
  }
}

function replaceSlotImage(images: string[], index: number, source: string, replacement: string): string[] | null {
  if (index < 0 || !sameImageSource(images[index], source)) return null;
  const next = [...images];
  next[index] = replacement;
  return next;
}

/**
 * Write a selected inpaint output back only when the original source still
 * occupies its recorded slot. This protects a newer generation from being
 * silently overwritten by an older inpaint workspace.
 */
export async function replaceInpaintTarget(target: InpaintTarget, replacement: string): Promise<boolean> {
  switch (target.type) {
    case 'yinghua': {
      if (!target.slotId || target.index === undefined) return false;
      const store = useYinghuaStore.getState();
      const next = replaceSlotImage(
        store.yinghuaSlots[target.slotId].images,
        target.index,
        target.url,
        replacement,
      );
      if (!next) return false;
      store.setYinghuaSlot(target.slotId, { status: 'done', images: next, error: undefined });
      return true;
    }
    case 'poster': {
      if (target.index === undefined) return false;
      const store = useWorkbenchStore.getState();
      const next = replaceSlotImage(store.posterSlot.images, target.index, target.url, replacement);
      if (!next) return false;
      store.setPosterSlot({ status: 'done', images: next, error: undefined });
      return true;
    }
    case 'costume': {
      if (target.index === undefined) return false;
      const store = useWorkbenchStore.getState();
      const next = replaceSlotImage(store.costumeChangeSlot.images, target.index, target.url, replacement);
      if (!next) return false;
      store.setCostumeChangeSlot({ status: 'done', images: next, error: undefined });
      return true;
    }
    case 'three-view': {
      if (target.index === undefined) return false;
      const store = useWorkbenchStore.getState();
      const next = replaceSlotImage(store.threeViewSlot.images, target.index, target.url, replacement);
      if (!next) return false;
      store.setThreeViewSlot({ status: 'done', images: next, error: undefined });
      return true;
    }
    case 'upload': {
      const store = useUploadStore.getState();
      if (!sameImageSource(store.uploadedImage ?? undefined, target.url)) return false;
      store.setUpload(replacement, 'inpaint-result.png');
      try {
        const palette = await extractPalette(replacement);
        store.setPalette(palette);
        applyTheme(palette);
      } catch {
        // The new image is still valid even if palette extraction is unavailable
        // (for example a relay URL without browser-readable CORS headers).
      }
      return true;
    }
    default:
      return false;
  }
}
