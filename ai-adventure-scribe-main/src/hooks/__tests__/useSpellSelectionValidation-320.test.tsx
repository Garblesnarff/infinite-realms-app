/**
 * #320 CR-010: a stale "Expected 4 cantrips ... but got 3" warning must never
 * be shown for a selection that already has 4 cantrips.
 *
 * The validation result is produced asynchronously and stored in state, so
 * without an explicit reset it keeps describing the *previous* selection
 * until the revalidation lands. These tests use the REAL validators (no
 * mocks) and the real spell catalog, and prove the committed validation
 * never lags behind the selection.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { useSpellSelectionValidation } from '../useSpellSelectionValidation';

import type { UseSpellSelectionValidationReturn } from '../useSpellSelectionValidation';
import type { Character, Spell } from '@/types/character';
import type { RenderHookResult } from '@testing-library/react';

import { getClassSpells } from '@/data/spellOptions';

// spell-validation/utils.ts (multiclass helpers, re-exported by the barrel
// file the hook imports) pulls in @/services/spellApi, which is never
// exercised on this path — mock it for module resolution only. The validators
// under test run against the real static catalog above.
vi.mock('@/services/spellApi', () => ({ spellApi: {} }));

const sorcererCharacter: Character = {
  id: 'char-sorcerer',
  name: 'Test Sorcerer',
  level: 1,
  class: {
    id: 'sorcerer',
    name: 'Sorcerer',
    description: 'A wielder of innate magic',
    hitDie: 6,
    primaryAbility: 'charisma',
    savingThrowProficiencies: ['constitution', 'charisma'],
    skillChoices: [],
    numSkillChoices: 2,
    spellcasting: {
      ability: 'charisma',
      cantripsKnown: 4,
      spellsKnown: 2,
    },
    classFeatures: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    subclasses: [],
  },
  race: {
    id: 'human',
    name: 'Human',
    description: 'Versatile',
    abilityScoreIncrease: {},
    speed: 30,
    traits: [],
    languages: ['Common'],
  },
  abilityScores: {
    strength: { score: 10, modifier: 0, savingThrow: false },
    dexterity: { score: 10, modifier: 0, savingThrow: false },
    constitution: { score: 10, modifier: 0, savingThrow: false },
    intelligence: { score: 10, modifier: 0, savingThrow: false },
    wisdom: { score: 10, modifier: 0, savingThrow: false },
    charisma: { score: 10, modifier: 0, savingThrow: false },
  },
};

// Real catalog data — the same producer the wizard's spell fetch serves.
const sorcererCantrips: Spell[] = getClassSpells('Sorcerer').cantrips;
const sorcererSpells: Spell[] = getClassSpells('Sorcerer').spells;
const cantripIds = sorcererCantrips.slice(0, 4).map((c) => c.id);
const spellIds = sorcererSpells.slice(0, 2).map((s) => s.id);
const availableCantrips = sorcererCantrips.slice(0, 4);
const availableSpells = sorcererSpells.slice(0, 2);

const STALE_MESSAGE = 'Expected 4 cantrips (4 class + 0 racial), but got 3';

function renderValidation(
  initialSelected: string[],
): RenderHookResult<UseSpellSelectionValidationReturn, { selected: string[] }> {
  return renderHook(
    ({ selected }) =>
      useSpellSelectionValidation({
        character: sorcererCharacter,
        selectedCantrips: selected,
        selectedSpells: spellIds,
        availableCantrips,
        availableSpells,
      }),
    { initialProps: { selected: initialSelected } },
  );
}

describe('useSpellSelectionValidation #320 CR-010 (stale count warning)', () => {
  it('catalog has enough Sorcerer spells for the scenario', () => {
    expect(sorcererCantrips.length).toBeGreaterThanOrEqual(4);
    expect(sorcererSpells.length).toBeGreaterThanOrEqual(2);
  });

  it('never shows the stale "got 3" count error once the 4th cantrip is picked', async () => {
    const { result, rerender } = renderValidation(cantripIds.slice(0, 3));

    // 3/4 selected: the count error is genuine and must be shown.
    await waitFor(() => {
      expect(result.current.validation.errors.map((e) => e.message)).toContain(STALE_MESSAGE);
    });

    // Pick the 4th cantrip. The very next committed validation must not be
    // the stale "got 3" error: the previous result is cleared the moment the
    // inputs change, while the revalidation is in flight.
    rerender({ selected: cantripIds });

    expect(result.current.validation.errors).toEqual([]);
    expect(result.current.isValidating).toBe(true);

    // The revalidation then lands: 4/4 is valid.
    await waitFor(() => {
      expect(result.current.isValidating).toBe(false);
    });
    expect(result.current.validation.valid).toBe(true);
    expect(result.current.validation.errors).toEqual([]);
    expect(result.current.canProceed).toBe(true);
  });

  it('clears a stale valid result when a cantrip is removed', async () => {
    const { result, rerender } = renderValidation(cantripIds);

    await waitFor(() => {
      expect(result.current.validation.valid).toBe(true);
    });
    expect(result.current.validation.errors).toEqual([]);

    // Drop back to 3/4. The committed validation must not still claim valid
    // from the previous 4/4 selection.
    rerender({ selected: cantripIds.slice(0, 3) });

    expect(result.current.validation.valid).toBe(false);
    expect(result.current.validation.errors).toEqual([]);
    expect(result.current.isValidating).toBe(true);

    await waitFor(() => {
      expect(result.current.validation.errors.map((e) => e.message)).toContain(STALE_MESSAGE);
    });
    expect(result.current.canProceed).toBe(false);
  });

  it('stays neutral for a null character', () => {
    const { result } = renderHook(() =>
      useSpellSelectionValidation({
        character: null,
        selectedCantrips: [],
        selectedSpells: [],
        availableCantrips: [],
        availableSpells: [],
      }),
    );

    expect(result.current.validation).toEqual({ valid: false, errors: [], warnings: [] });
    expect(result.current.isValidating).toBe(false);
    expect(result.current.canProceed).toBe(false);
  });
});
