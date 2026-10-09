import { render } from '@testing-library/react';
import React, { useEffect } from 'react';

import type { Character, CharacterClass } from '@/types/character';

import SpellSelection from '@/components/character-creation/steps/SpellSelection';
import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { cleric } from '@/data/classes/cleric';
import { fighter } from '@/data/classes/fighter';
import { wizard } from '@/data/classes/wizard';
import { human } from '@/data/races/human';

/**
 * Shared setup for the SpellSelection component test suites.
 *
 * The suites render the REAL SpellSelection component (not a test-local copy).
 * Only the network transport is stubbed: `spellApi.getClassSpells` is backed by
 * the real SRD spell catalog (`@/data/spells/api`) and `saveCharacterSpells`
 * stays pending (never resolves) without touching the network. Characters use the REAL class catalog
 * (`@/data/classes/*`) and the real human race — no invented classes.
 *
 * NOTE: the `vi.mock('@/services/spellApi')` / `vi.mock('@/services/characterSpellApi')`
 * calls live in each test file (vitest hoists them per-file); the mock fns are
 * created with `vi.hoisted` there and wired to the real catalog in `beforeEach`.
 */

const baseAbilityScores = {
  strength: { score: 10, modifier: 0, savingThrow: false },
  dexterity: { score: 14, modifier: 2, savingThrow: false },
  constitution: { score: 13, modifier: 1, savingThrow: false },
  intelligence: { score: 15, modifier: 2, savingThrow: true },
  wisdom: { score: 12, modifier: 1, savingThrow: true },
  charisma: { score: 8, modifier: -1, savingThrow: false },
};

export function buildCharacter(
  name: string,
  characterClass: CharacterClass,
  overrides: Partial<Character> = {},
): Character {
  return {
    id: `${name.toLowerCase().replace(/\s+/g, '-')}-test`,
    name,
    level: 1,
    class: characterClass,
    race: human,
    abilityScores: {
      ...baseAbilityScores,
      intelligence: {
        ...baseAbilityScores.intelligence,
        savingThrow: characterClass.savingThrowProficiencies.includes('intelligence'),
      },
      wisdom: {
        ...baseAbilityScores.wisdom,
        savingThrow: characterClass.savingThrowProficiencies.includes('wisdom'),
      },
      charisma: {
        ...baseAbilityScores.charisma,
        savingThrow: characterClass.savingThrowProficiencies.includes('charisma'),
      },
    },
    ...overrides,
  };
}

export const buildWizardCharacter = (
  name = 'Test Wizard',
  overrides: Partial<Character> = {},
): Character => buildCharacter(name, wizard, overrides);

export const buildClericCharacter = (
  name = 'Test Cleric',
  overrides: Partial<Character> = {},
): Character => buildCharacter(name, cleric, overrides);

export const buildFighterCharacter = (
  name = 'Test Fighter',
  overrides: Partial<Character> = {},
): Character => buildCharacter(name, fighter, overrides);

/**
 * Render the real SpellSelection with the given character seeded into the
 * CharacterContext (via the real SET_CHARACTER reducer path).
 */
export function renderSpellSelection(character: Character): ReturnType<typeof render> {
  function Seeder(): React.JSX.Element {
    const { dispatch } = useCharacter();
    useEffect(() => {
      dispatch({ type: 'SET_CHARACTER', payload: character });
    }, [dispatch]);
    return <SpellSelection />;
  }

  return render(
    <CharacterProvider>
      <Seeder />
    </CharacterProvider>,
  );
}
