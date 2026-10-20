/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #899 Life Domain cleric (D20-003): the prepared-spell cap is WIS modifier
 * + level, and the domain spells (Bless, Cure Wounds) are always prepared
 * on top of the player's picks — they never consume a preparation slot.
 *
 * Fixture fidelity: the character's classFeatures use the real
 * ClassFeatureSelection producer shape (Record<featureId, {name,
 * description, choice}>) with the real Divine Domain option strings from
 * src/data/classes/cleric.ts, and the class itself is the real cleric data.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAdvancedSpellcasting } from '../useAdvancedSpellcasting';

import { validateAdvancedSpellcasting } from '@/components/character-creation/wizard/wizard-spell-validators';
import { useCharacter } from '@/contexts/CharacterContext';
import { cleric } from '@/data/classes/cleric';
import { human } from '@/data/races/human';
import { spellApi } from '@/services/spellApi';

vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));
vi.mock('@/hooks/use-toast', () => ({ useToast: vi.fn(() => ({ toast: vi.fn() })) }));
vi.mock('@/services/spellApi', () => ({ spellApi: { getClassSpells: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const CLERIC_SPELLS = {
  cantrips: [
    { id: 'guidance', name: 'Guidance', level: 0 },
    { id: 'sacred-flame', name: 'Sacred Flame', level: 0 },
    { id: 'thaumaturgy', name: 'Thaumaturgy', level: 0 },
  ],
  spells: [
    { id: 'bless', name: 'Bless', level: 1 },
    { id: 'cure-wounds', name: 'Cure Wounds', level: 1 },
    { id: 'guiding-bolt', name: 'Guiding Bolt', level: 1 },
    { id: 'healing-word', name: 'Healing Word', level: 1 },
    { id: 'sanctuary', name: 'Sanctuary', level: 1 },
    { id: 'shield-of-faith', name: 'Shield of Faith', level: 1 },
  ],
};

const domainFeatures = (choice: string) => ({
  'divine-domain': {
    name: 'Divine Domain',
    description:
      'Choose one domain related to your deity. Your choice grants you domain spells and other features when you choose it at 1st level.',
    choice,
  },
  spellcasting: {
    name: 'Spellcasting',
    description: 'As a conduit for divine power, you can cast cleric spells.',
  },
});

const lifeCleric = (wisdomScore: number) => ({
  id: 'cleric-899',
  class: cleric,
  level: 1,
  race: human,
  subrace: null,
  classFeatures: domainFeatures('Life Domain: Focuses on healing and protection'),
  abilityScores: {
    strength: { score: 10, modifier: 0 },
    dexterity: { score: 10, modifier: 0 },
    constitution: { score: 14, modifier: 2 },
    intelligence: { score: 10, modifier: 0 },
    wisdom: {
      score: wisdomScore,
      modifier: Math.floor((wisdomScore - 10) / 2),
    },
    charisma: { score: 10, modifier: 0 },
  },
});

function appliedPayload(dispatch: ReturnType<typeof vi.fn>): any {
  const calls = dispatch.mock.calls
    .map((c: any[]) => c[0])
    .filter((a: any) => a?.type === 'UPDATE_CHARACTER' && Array.isArray(a.payload?.preparedSpells));
  return calls[calls.length - 1]?.payload;
}

describe('#899 useAdvancedSpellcasting — Life Domain cleric', () => {
  let dispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatch = vi.fn();
    (spellApi.getClassSpells as any).mockResolvedValue(CLERIC_SPELLS);
  });

  it('caps preparation at WIS modifier + level and grants the domain spells', async () => {
    (useCharacter as any).mockReturnValue({
      state: { character: lifeCleric(16) },
      dispatch,
    });
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    // D20-003 pin: the cap is WIS mod (+3) + level (1) = 4, not 1.
    expect(result.current.maxPreparedSpells).toBe(4);
    expect(result.current.alwaysPreparedSpells).toEqual(['Bless', 'Cure Wounds']);

    for (const id of ['guiding-bolt', 'healing-word', 'sanctuary', 'shield-of-faith']) {
      act(() => result.current.handleSpellPreparation(id, true));
    }

    await waitFor(() => expect(appliedPayload(dispatch)).toBeDefined());
    const payload = appliedPayload(dispatch);
    expect(payload.preparedSpells).toEqual(
      expect.arrayContaining([
        'Guiding Bolt',
        'Healing Word',
        'Sanctuary',
        'Shield of Faith',
        'Bless',
        'Cure Wounds',
      ]),
    );
    expect(payload.preparedSpells).toHaveLength(6);
    expect(payload.preparedSpellIds).toHaveLength(6);

    // The saved character passes the step validator with cap + domain spells.
    const saved = {
      ...lifeCleric(16),
      preparedSpells: payload.preparedSpells,
    } as any;
    expect(validateAdvancedSpellcasting(saved).isValid).toBe(true);
  });

  it('does not duplicate a domain spell the player also picked by hand', async () => {
    (useCharacter as any).mockReturnValue({
      state: { character: lifeCleric(16) },
      dispatch,
    });
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    // Bless is free (always prepared), so four further picks complete the step.
    for (const id of ['bless', 'guiding-bolt', 'healing-word', 'sanctuary', 'shield-of-faith']) {
      act(() => result.current.handleSpellPreparation(id, true));
    }

    await waitFor(() => expect(appliedPayload(dispatch)).toBeDefined());
    const payload = appliedPayload(dispatch);
    expect(payload.preparedSpells.filter((n: string) => n === 'Bless')).toHaveLength(1);
    expect(payload.preparedSpells).toHaveLength(6);
  });

  it('gives a non-Life domain cleric no always-prepared spells', async () => {
    const lightCleric = {
      ...lifeCleric(16),
      classFeatures: domainFeatures('Light Domain: Harnesses the power of flame and radiance'),
    };
    (useCharacter as any).mockReturnValue({ state: { character: lightCleric }, dispatch });
    const { result } = renderHook(() => useAdvancedSpellcasting());
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    expect(result.current.alwaysPreparedSpells).toEqual([]);
    for (const id of ['bless', 'cure-wounds', 'guiding-bolt', 'healing-word']) {
      act(() => result.current.handleSpellPreparation(id, true));
    }
    await waitFor(() => expect(appliedPayload(dispatch)).toBeDefined());
    expect(appliedPayload(dispatch).preparedSpells).toHaveLength(4);
  });

  it('validator demands WIS modifier + level preparations (D20-003 count pin)', () => {
    const three = { ...lifeCleric(16), preparedSpells: ['Bless', 'Cure Wounds', 'Sanctuary'] } as any;
    const result = validateAdvancedSpellcasting(three);
    expect(result.isValid).toBe(false);
    expect(result.message).toContain('prepare 4 spells');
  });
});
