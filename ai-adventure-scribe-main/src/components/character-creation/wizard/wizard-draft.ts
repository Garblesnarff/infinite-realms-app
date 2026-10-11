import type { Character } from '@/types/character';

import logger from '@/lib/logger';

/** Bump when the stored shape changes so stale drafts are ignored, not misread. */
export const WIZARD_DRAFT_VERSION = 1;

export interface WizardDraft {
  version: typeof WIZARD_DRAFT_VERSION;
  character: Character;
  step: number;
  campaignId: string | null;
  updatedAt: string;
}

/**
 * Draft key is scoped to the user and the campaign context the wizard was
 * opened with, so a draft started from a campaign page is never offered
 * when creating a standalone character (and vice versa).
 */
export function getWizardDraftKey(userId: string, campaignId?: string | null): string {
  return campaignId
    ? `ir:wizard-draft:${userId}:campaign:${campaignId}`
    : `ir:wizard-draft:${userId}`;
}

export function readWizardDraft(key: string): WizardDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WizardDraft> | null;
    if (!parsed || parsed.version !== WIZARD_DRAFT_VERSION) return null;
    if (!parsed.character || typeof parsed.character !== 'object') return null;
    return {
      version: WIZARD_DRAFT_VERSION,
      character: parsed.character as Character,
      step:
        typeof parsed.step === 'number' && Number.isFinite(parsed.step) && parsed.step >= 0
          ? Math.floor(parsed.step)
          : 0,
      campaignId: typeof parsed.campaignId === 'string' ? parsed.campaignId : null,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch (error) {
    logger.warn(`Error reading wizard draft "${key}":`, error);
    return null;
  }
}

export function writeWizardDraft(key: string, draft: WizardDraft): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch (error) {
    logger.warn(`Error writing wizard draft "${key}":`, error);
  }
}

export function clearWizardDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    logger.warn(`Error clearing wizard draft "${key}":`, error);
  }
}

/** True when the character holds anything worth resuming (not a pristine wizard). */
export function hasWizardDraftData(character: Character | null | undefined): boolean {
  if (!character) return false;
  if (character.name?.trim()) return true;
  if (character.race || character.subrace || character.class || character.background) return true;
  if (character.alignment?.trim()) return true;
  if (character.gender || character.eyes?.trim() || character.hair?.trim() || character.skin?.trim())
    return true;
  if (typeof character.age === 'number' || typeof character.height === 'number') return true;
  if (
    character.personalityTraits?.length ||
    character.ideals?.length ||
    character.bonds?.length ||
    character.flaws?.length
  )
    return true;
  if (character.personalityNotes?.trim()) return true;
  if (character.enhancementSelections?.length) return true;
  if (character.equipment?.length) return true;
  if (
    character.skillProficiencies?.length ||
    character.toolProficiencies?.length ||
    character.languages?.length ||
    character.expertiseProficiencies?.length
  )
    return true;
  if (
    character.cantrips?.length ||
    character.knownSpells?.length ||
    character.preparedSpells?.length ||
    character.ritualSpells?.length ||
    character.metamagicOptions?.length ||
    character.pactMagicSpells?.length
  )
    return true;
  const scores = character.abilityScores;
  if (
    scores &&
    Object.values(scores).some((entry) => entry && entry.score !== 10)
  )
    return true;
  return false;
}
