/** Return the prompt to apply, or null when replacing a non-empty draft is declined. */
export function promptDraftReplacement(currentDraft: string, nextPrompt: string, confirmReplace: () => boolean): string | null {
  if (currentDraft.trim() && !confirmReplace()) return null;
  return nextPrompt;
}
