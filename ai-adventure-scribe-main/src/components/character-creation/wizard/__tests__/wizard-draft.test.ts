import { describe, it, expect, beforeEach } from 'vitest';

import type { Character } from '@/types/character';

import {
  WIZARD_DRAFT_VERSION,
  clearWizardDraft,
  getWizardDraftKey,
  hasWizardDraftData,
  readWizardDraft,
  writeWizardDraft,
  type WizardDraft,
} from '@/components/character-creation/wizard/wizard-draft';

const KEY = 'ir:wizard-draft:test-user';

function makeDraft(overrides: Partial<WizardDraft> = {}): WizardDraft {
  return {
    version: WIZARD_DRAFT_VERSION,
    character: { name: 'Draft Hero' } as Character,
    step: 3,
    campaignId: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('wizard-draft storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keys drafts per user, and per campaign when present', () => {
    expect(getWizardDraftKey('u1')).toBe('ir:wizard-draft:u1');
    expect(getWizardDraftKey('u1', 'c9')).toBe('ir:wizard-draft:u1:campaign:c9');
    expect(getWizardDraftKey('u1')).not.toBe(getWizardDraftKey('u2'));
  });

  it('round-trips a draft through localStorage', () => {
    const draft = makeDraft();
    writeWizardDraft(KEY, draft);
    expect(readWizardDraft(KEY)).toEqual(draft);
  });

  it('returns null when nothing is stored', () => {
    expect(readWizardDraft(KEY)).toBeNull();
  });

  it('returns null for corrupted JSON instead of throwing', () => {
    window.localStorage.setItem(KEY, '{not-json');
    expect(readWizardDraft(KEY)).toBeNull();
  });

  it('returns null for a stale version or a non-object character', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ...makeDraft(), version: 999 }));
    expect(readWizardDraft(KEY)).toBeNull();
    window.localStorage.setItem(KEY, JSON.stringify({ ...makeDraft(), character: 'nope' }));
    expect(readWizardDraft(KEY)).toBeNull();
  });

  it('normalizes a bad step to 0', () => {
    window.localStorage.setItem(KEY, JSON.stringify({ ...makeDraft(), step: -4 }));
    expect(readWizardDraft(KEY)?.step).toBe(0);
    window.localStorage.setItem(KEY, JSON.stringify({ ...makeDraft(), step: 2.7 }));
    expect(readWizardDraft(KEY)?.step).toBe(2);
  });

  it('clear removes the draft', () => {
    writeWizardDraft(KEY, makeDraft());
    clearWizardDraft(KEY);
    expect(readWizardDraft(KEY)).toBeNull();
  });
});

describe('hasWizardDraftData', () => {
  it('is false for null or a pristine character', () => {
    expect(hasWizardDraftData(null)).toBe(false);
    expect(hasWizardDraftData({} as Character)).toBe(false);
    expect(hasWizardDraftData({ name: '   ' } as Character)).toBe(false);
  });

  it('is true for any meaningful selection', () => {
    expect(hasWizardDraftData({ name: 'Ari' } as Character)).toBe(true);
    expect(hasWizardDraftData({ race: { name: 'Elf' } } as Character)).toBe(true);
    expect(hasWizardDraftData({ class: { name: 'Wizard' } } as Character)).toBe(true);
    expect(hasWizardDraftData({ background: { name: 'Sage' } } as Character)).toBe(true);
    expect(hasWizardDraftData({ equipment: ['Longsword'] } as Character)).toBe(true);
    expect(hasWizardDraftData({ languages: ['Elvish'] } as Character)).toBe(true);
    expect(hasWizardDraftData({ cantrips: ['Fire Bolt'] } as Character)).toBe(true);
    expect(hasWizardDraftData({ personalityNotes: 'gruff' } as Character)).toBe(true);
  });

  it('treats untouched default ability scores as no data', () => {
    const allTens = {
      strength: { score: 10, modifier: 0, savingThrow: false },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    };
    expect(hasWizardDraftData({ abilityScores: allTens } as unknown as Character)).toBe(false);
    expect(
      hasWizardDraftData({
        abilityScores: { ...allTens, strength: { score: 16, modifier: 3, savingThrow: false } },
      } as unknown as Character),
    ).toBe(true);
  });
});
