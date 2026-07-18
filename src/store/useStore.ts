/**
 * useStore — backward-compatible barrel.
 *
 * The original monolithic store has been split into domain slices:
 *   useUploadStore, useIdentityStore, useProviderStore,
 *   useWorkbenchStore, useYinghuaStore, useViewerStore
 *
 * This file re-exports everything so existing import paths keep working.
 * New code should import from the individual slice files directly.
 */

// ── Re-export slices ──────────────────────────────────────────────────────────
export { useUploadStore } from './useUploadStore';
export { useIdentityStore } from './useIdentityStore';
export { useProviderStore, type CustomProviderConfig } from './useProviderStore';
export { useWorkbenchStore } from './useWorkbenchStore';
export { useYinghuaStore } from './useYinghuaStore';
export { useViewerStore } from './useViewerStore';

// ── Re-export types ───────────────────────────────────────────────────────────
export type {
  GenSlot,
  LayerPart,
  NamePlacement,
  Palette,
  ProviderName,
  YinghuaStyleId,
} from '../types';
export type { ClipRegions } from '../lib/clipRegions';
export type { FaceBounds } from '../lib/detectFace';
