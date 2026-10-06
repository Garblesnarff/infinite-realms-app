import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { RestApiResult } from '@/services/rest-api';
import type { Character, CharacterClass } from '@/types/character';

import {
  useSpells,
  resolveSpellcastingAbility,
  toTabSpellSlots,
} from '@/features/character/components/sheet/tabs/spells/useSpells';
import { restApi } from '@/services/rest-api';

// Mock the spell API service (disabled so the hook uses character data only)
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    isEnabled: vi.fn(() => false),
    getCharacterSpells: vi.fn(),
  },
}));

// Mock the rest API — the shared rest path the tab's Long Rest must use
vi.mock('@/services/rest-api', () => ({
  restApi: {
    shortRest: vi.fn(),
    longRest: vi.fn(),
    attuneItem: vi.fn(),
  },
  applyRestResultToCharacter: (
    character: Character,
    result: { spellSlots: Record<string, { max?: number; current?: number }> | null },
  ): Character => ({
    ...character,
    spellSlots: result.spellSlots
      ? Object.fromEntries(
          Object.entries(result.spellSlots).map(([level, slot]) => [
            Number(level),
            { max: slot.max ?? 0, current: slot.current ?? 0 },
          ]),
        )
      : character.spellSlots,
  }),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function ability(score: number): { score: number; modifier: number; savingThrow: boolean } {
  const modifier = Math.floor((score - 10) / 2);
  return { score, modifier, savingThrow: false };
}

function makeClass(name: string, primaryAbility: 'wisdom' | 'charisma'): CharacterClass {
  return {
    id: name.toLowerCase(),
    name,
    description: `A ${name}`,
    hitDie: 8,
    primaryAbility,
    savingThrowProficiencies: [primaryAbility],
    skillChoices: [],
    numSkillChoices: 0,
    classFeatures: [],
    subclasses: [],
    armorProficiencies: [],
    weaponProficiencies: [],
  } as CharacterClass;
}

/**
 * Fixture shaped like a character produced by loadCharacterWithSpells:
 * class object with a name, level, ability scores with modifiers, and
 * spellSlots in the { max, current } shape parsed from the characters table.
 */
function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-123',
    user_id: 'user-1',
    name: 'Test Cleric',
    race: null,
    class: makeClass('Cleric', 'wisdom'),
    level: 3,
    background: null,
    abilityScores: {
      strength: ability(10),
      dexterity: ability(12),
      constitution: ability(14),
      intelligence: ability(10),
      wisdom: ability(16),
      charisma: ability(11),
    },
    experience: 0,
    alignment: '',
    description: '',
    skillProficiencies: [],
    expertiseProficiencies: [],
    toolProficiencies: [],
    savingThrowProficiencies: [],
    languages: [],
    personalityTraits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    equipment: [],
    cantrips: [],
    knownSpells: [],
    preparedSpells: [],
    ritualSpells: [],
    spellSlots: {
      1: { max: 4, current: 2 },
      2: { max: 3, current: 3 },
    },
    ...overrides,
  } as Character;
}

describe('useSpells', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('derives the spellcasting ability from the class (Wisdom for Cleric), not Intelligence', () => {
    // Cleric: WIS 16 (+3), INT 10 (+0), level 3 (proficiency +2)
    // The character object must be stable across renders (use a const, not a
    // call inside the render callback) or the slots-sync effect loops.
    const character = makeCharacter();
    const { result } = renderHook(() => useSpells(character));

    expect(result.current.spellcastingAbility).toBe('wisdom');
    // DC = 8 + WIS mod 3 + prof 2 = 13 (would be 10 with Intelligence)
    expect(result.current.spellSaveDC).toBe(13);
    // Attack = WIS mod 3 + prof 2 = 5 (would be 2 with Intelligence)
    expect(result.current.spellAttackBonus).toBe(5);
  });

  it('derives the spellcasting ability from the class (Charisma for Sorcerer), not Intelligence', () => {
    const sorcerer = makeCharacter({
      name: 'Test Sorcerer',
      class: makeClass('Sorcerer', 'charisma'),
      level: 5,
      abilityScores: {
        strength: ability(8),
        dexterity: ability(14),
        constitution: ability(14),
        intelligence: ability(10),
        wisdom: ability(12),
        charisma: ability(18),
      },
    });

    const { result } = renderHook(() => useSpells(sorcerer));

    expect(result.current.spellcastingAbility).toBe('charisma');
    // DC = 8 + CHA mod 4 + prof 3 = 15 (would be 11 with Intelligence)
    expect(result.current.spellSaveDC).toBe(15);
    // Attack = CHA mod 4 + prof 3 = 7 (would be 3 with Intelligence)
    expect(result.current.spellAttackBonus).toBe(7);
  });

  it('builds the slot grid from the character record, not hardcoded demo data', () => {
    const character = makeCharacter();
    const { result } = renderHook(() => useSpells(character));

    // { max: 4, current: 2 } -> { total: 4, used: 2 }
    expect(result.current.spellSlots[1]).toEqual({ total: 4, used: 2 });
    // { max: 3, current: 3 } -> { total: 3, used: 0 }
    expect(result.current.spellSlots[2]).toEqual({ total: 3, used: 0 });
    // No phantom level 3-5 rows from the old hardcoded grid
    expect(result.current.spellSlots[3]).toBeUndefined();
    expect(result.current.spellSlots[4]).toBeUndefined();
    expect(result.current.spellSlots[5]).toBeUndefined();
  });

  it('Long Rest persists through the shared rest API and refills the grid from the result', async () => {
    const onUpdate = vi.fn();
    const character = makeCharacter();
    const { result } = renderHook(() => useSpells(character, onUpdate));

    // Two level-1 slots are used before the rest
    expect(result.current.spellSlots[1]?.used).toBe(2);

    // The rest endpoint returns refilled slots (character_spell_slots source
    // of truth after candidate 2; characters.spell_slots JSONB before that)
    const restResult = {
      characterId: 'char-123',
      restType: 'long',
      hpRestored: 10,
      hitDiceRemaining: [],
      resourcesRestored: [],
      spellSlots: {
        '1': { max: 4, current: 4 },
        '2': { max: 3, current: 3 },
      },
      pactSlots: null,
      classFeatures: [],
      restEventId: 'rest-1',
    } as unknown as RestApiResult;
    vi.mocked(restApi.longRest).mockResolvedValue(restResult);

    await act(async () => {
      await result.current.longRest();
    });

    // The tab called the shared rest path — the rest persisted server-side
    expect(restApi.longRest).toHaveBeenCalledTimes(1);
    expect(restApi.longRest).toHaveBeenCalledWith('char-123');

    // The grid refilled from the persisted result, not a local-only reset
    expect(result.current.spellSlots[1]).toEqual({ total: 4, used: 0 });
    expect(result.current.spellSlots[2]).toEqual({ total: 3, used: 0 });

    // The parent sheet refreshes so HP/hit dice reflect the rest too
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('Long Rest surfaces an inline rest error without touching slots or the page error state', async () => {
    const character = makeCharacter();
    const { result } = renderHook(() => useSpells(character));

    vi.mocked(restApi.longRest).mockRejectedValue(new Error('network down'));

    await act(async () => {
      await result.current.longRest();
    });

    // The failure lands on restError, shown inline in the slots section —
    // never on the page-level error that would swap the tabs for an error
    // screen with a page-reload Retry.
    expect(result.current.restError).toBe('network down');
    expect(result.current.error).toBeNull();
    expect(result.current.resting).toBe(false);
    // Slots are untouched when the rest did not persist
    expect(result.current.spellSlots[1]).toEqual({ total: 4, used: 2 });
  });

  it('reports a resting flag while the rest is in flight', async () => {
    const character = makeCharacter();
    const { result } = renderHook(() => useSpells(character));

    let resolveRest!: (value: unknown) => void;
    const restDeferred = new Promise<unknown>((resolve) => {
      resolveRest = resolve;
    });
    vi.mocked(restApi.longRest).mockImplementation(() => restDeferred as Promise<RestApiResult>);

    let restPromise!: Promise<void>;
    act(() => {
      restPromise = result.current.longRest();
    });
    expect(result.current.resting).toBe(true);

    await act(async () => {
      resolveRest({
        characterId: 'char-123',
        restType: 'long',
        spellSlots: { '1': { max: 4, current: 4 }, '2': { max: 3, current: 3 } },
      });
      await restPromise;
    });
    expect(result.current.resting).toBe(false);
    expect(result.current.restError).toBeNull();
  });

  it('returns null spellcasting ability for a Fighter — never a fallback Intelligence', () => {
    const fighter = makeCharacter({
      name: 'Test Fighter',
      class: {
        id: 'fighter',
        name: 'Fighter',
        description: 'A Fighter',
        hitDie: 10,
        primaryAbility: 'strength',
        savingThrowProficiencies: ['strength', 'constitution'],
        skillChoices: [],
        numSkillChoices: 0,
        classFeatures: [],
        subclasses: [],
        armorProficiencies: [],
        weaponProficiencies: [],
      } as CharacterClass,
    });

    // The resolver itself: null, not 'intelligence'
    expect(resolveSpellcastingAbility(fighter)).toBeNull();

    const { result } = renderHook(() => useSpells(fighter));
    expect(result.current.spellcastingAbility).toBeNull();
    expect(result.current.spellcastingAbility).not.toBe('intelligence');
    expect(result.current.spellAttackBonus).toBeNull();
    expect(result.current.spellSaveDC).toBeNull();
  });

  it('returns null spellcasting ability when the character has no class', () => {
    const classless = makeCharacter({ class: null });
    expect(resolveSpellcastingAbility(classless)).toBeNull();

    const { result } = renderHook(() => useSpells(classless));
    expect(result.current.spellcastingAbility).toBeNull();
  });

  it('converts the real loader slot shape ({max, current}) into the tab grid', () => {
    // The exact shape the character read route serves after
    // overlayEngineSpellSlots replaces spell_slots with the
    // character_spell_slots table rows: { [level]: { max, current } }.
    const loaderShape = {
      1: { max: 4, current: 1 },
      2: { max: 3, current: 3 },
      3: { max: 2, current: 0 },
    };

    expect(toTabSpellSlots(loaderShape)).toEqual({
      1: { total: 4, used: 3 },
      2: { total: 3, used: 0 },
      3: { total: 2, used: 2 },
    });
    // The loader yields undefined when the character has no slot rows
    expect(toTabSpellSlots(undefined)).toEqual({});
  });
});
