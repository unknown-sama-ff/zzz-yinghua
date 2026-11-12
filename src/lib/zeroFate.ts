import type { ZeroFateDraft, ZeroFateDraftContext } from '../types';

export function isCurrentZeroFateDraft(draft: ZeroFateDraft, context: ZeroFateDraftContext): boolean {
  return Boolean(draft.images[0] && draft.context
    && draft.context.sourceImage === context.sourceImage
    && draft.context.addonImage === context.addonImage
    && (draft.context.breakdownImage ?? null) === (context.breakdownImage ?? null)
    && draft.context.prompt === context.prompt);
}
