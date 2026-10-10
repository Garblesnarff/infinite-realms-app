import React from 'react';

import {
  clearWizardDraft,
  getWizardDraftKey,
  hasWizardDraftData,
  readWizardDraft,
  writeWizardDraft,
  WIZARD_DRAFT_VERSION,
  type WizardDraft,
} from './wizard-draft';

import type { Character } from '@/types/character';

const AUTOSAVE_DELAY_MS = 500;

export interface UseWizardDraftOptions {
  character: Character | null;
  currentStep: number;
  /** Auth user id; null until auth resolves. No draft work happens without it. */
  userId: string | null;
  /** The wizard's ?campaign= param, if any. Scopes the draft key. */
  campaignId: string | null;
  /** Called with the stored draft when the user chooses Resume. */
  onRestore: (draft: WizardDraft) => void;
}

export interface UseWizardDraftApi {
  /** A stored draft with data, awaiting the user's resume/discard decision. */
  pendingDraft: WizardDraft | null;
  resumeDraft: () => void;
  discardDraft: () => void;
  /** Clear the draft and stop any further autosaves (call on Complete/Cancel). */
  clearDraft: () => void;
}

/**
 * Persists the in-progress wizard character to localStorage (debounced),
 * keyed per user, and surfaces a stored draft for an explicit resume choice.
 * All storage access is try/catch-wrapped inside wizard-draft.ts.
 */
export function useWizardDraft({
  character,
  currentStep,
  userId,
  campaignId,
  onRestore,
}: UseWizardDraftOptions): UseWizardDraftApi {
  const key = userId ? getWizardDraftKey(userId, campaignId) : null;
  const [pendingDraft, setPendingDraft] = React.useState<WizardDraft | null>(null);

  // Refs mirror the decision state synchronously: effects declared below run
  // in the same commit, so the autosave effect must see the pending decision
  // immediately, not after the next render.
  const checkedKeyRef = React.useRef<string | null>(null);
  const decisionPendingRef = React.useRef(false);
  const clearedRef = React.useRef(false);
  const onRestoreRef = React.useRef(onRestore);
  onRestoreRef.current = onRestore;

  // Look for a stored draft once per key, before any autosave can overwrite it.
  React.useEffect(() => {
    if (!key || checkedKeyRef.current === key) return;
    checkedKeyRef.current = key;
    const draft = readWizardDraft(key);
    if (draft && hasWizardDraftData(draft.character)) {
      decisionPendingRef.current = true;
      setPendingDraft(draft);
    }
  }, [key]);

  // Autosave the draft while the wizard is dirty. Skipped until the resume
  // decision is resolved, and permanently after clearDraft().
  React.useEffect(() => {
    if (!key || decisionPendingRef.current || clearedRef.current) return;
    if (!hasWizardDraftData(character)) return;
    const timer = window.setTimeout(() => {
      if (clearedRef.current || decisionPendingRef.current) return;
      writeWizardDraft(key, {
        version: WIZARD_DRAFT_VERSION,
        character: character as Character,
        step: currentStep,
        campaignId,
        updatedAt: new Date().toISOString(),
      });
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [key, character, currentStep, campaignId]);

  const resumeDraft = React.useCallback(() => {
    setPendingDraft((draft) => {
      if (draft) onRestoreRef.current(draft);
      return null;
    });
    decisionPendingRef.current = false;
  }, []);

  const discardDraft = React.useCallback(() => {
    if (key) clearWizardDraft(key);
    decisionPendingRef.current = false;
    setPendingDraft(null);
  }, [key]);

  const clearDraft = React.useCallback(() => {
    clearedRef.current = true;
    decisionPendingRef.current = false;
    if (key) clearWizardDraft(key);
    setPendingDraft(null);
  }, [key]);

  return React.useMemo(
    () => ({ pendingDraft, resumeDraft, discardDraft, clearDraft }),
    [pendingDraft, resumeDraft, discardDraft, clearDraft],
  );
}
