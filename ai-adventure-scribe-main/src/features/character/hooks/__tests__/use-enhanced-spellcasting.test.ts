import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useEnhancedSpellcasting } from '../use-enhanced-spellcasting';

import type { Character } from '@/types/character';

// Mock dependencies
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getAllSpells: vi.fn().mockResolvedValue([
      {
        id: 'fireball',
        name: 'Fireball',
        level: 3,
        school: 'Evocation',
        casting_time: '1 action',
        range: '150 feet',
        components_verbal: true,
        components_somatic: true,
        components_material: true,
        material_components: 'A tiny ball of bat guano and sulfur',
        duration: 'Instantaneous',
        description: 'A bright streak flashes from your pointing finger...',
      },
      {
        id: 'light',
        name: 'Light',
        level: 0,
        school: 'Evocation',
        casting_time: '1 action',
        range: 'Touch',
        components_verbal: true,
        components_somatic: false,
        components_material: true,
        material_components: 'A firefly or phosphorescent moss',
        duration: '1 hour',
        description: 'You touch one object...',
      },
      {
        id: 'detect-magic',
        name: 'Detect Magic',
        level: 1,
        school: 'Divination',
        casting_time: '1 action',
        range: 'Self',
        components_verbal: true,
        components_somatic: true,
        components_material: false,
        duration: '10 minutes',
        description: 'For the duration, you sense the presence of magic...',
        ritual: true,
      },
    ]),
  },
}));

vi.mock('@/data/spellcastingFeatures', () => ({
  metamagicOptions: [
    { id: 'careful-spell', name: 'Careful Spell', sorceryPointCost: 1 },
    { id: 'distant-spell', name: 'Distant Spell', sorceryPointCost: 1 },
  ],
}));

const mockCharacter: Character = {
  id: 'test-char',
  name: 'Test Wizard',
  level: 5,
  class: {
    name: 'Wizard',
    className: 'wizard',
    level: 5,
    spellcasting: {
      ability: 'intelligence',
      ritualCasting: true,
    },
  },
  classLevels: [
    { className: 'wizard', level: 5 }
  ],
  abilityScores: {
    intelligence: { score: 18, modifier: 4 },
  },
  cantrips: ['light'],
  knownSpells: ['fireball', 'detect-magic'],
  preparedSpells: ['fireball'],
  ritualSpells: ['detect-magic'],
  spellSlots: {
    1: { max: 4, current: 4 },
    2: { max: 3, current: 3 },
    3: { max: 2, current: 2 },
  },
  pactSlots: { current: 1, maximum: 2, level: 3 },
  sorceryPoints: { current: 3, maximum: 5 },
  metamagicOptions: ['careful-spell'],
} as unknown as Character;

describe('useEnhancedSpellcasting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with correct character stats', async () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    // Proficiency at level 5 is +3. Int mod is +4.
    // Attack bonus = 4 + 3 = 7. Save DC = 8 + 4 + 3 = 15.
    expect(result.current.spellAttackBonus).toBe(7);
    expect(result.current.spellSaveDC).toBe(15);
    expect(result.current.proficiencyBonus).toBe(3);
    expect(result.current.spellcastingAbility).toBe('intelligence');
  });

  it('should fetch spells and derive spell lists', async () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    // Wait for spells to load
    await waitFor(() => expect(result.current.isLoadingSpells).toBe(false));

    expect(result.current.allSpells).toHaveLength(3);
    expect(result.current.knownCantrips).toHaveLength(1);
    expect(result.current.knownCantrips[0]?.id).toBe('light');
    expect(result.current.knownSpells).toHaveLength(2);
    expect(result.current.preparedSpells).toHaveLength(1);
    expect(result.current.preparedSpells[0]?.id).toBe('fireball');
    expect(result.current.ritualSpells).toHaveLength(1);
    expect(result.current.ritualSpells[0]?.id).toBe('detect-magic');
  });

  it('should initialize spell slots from character data', () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    // Wizard 5 slots: 4/3/2
    expect(result.current.spellSlots[1]?.total).toBe(4);
    expect(result.current.spellSlots[1]?.used).toBe(0);
    expect(result.current.spellSlots[2]?.total).toBe(3);
    expect(result.current.spellSlots[2]?.used).toBe(0);
    expect(result.current.spellSlots[3]?.total).toBe(2);
    expect(result.current.spellSlots[3]?.used).toBe(0);
  });

  it('should manage spell slot consumption and restoration', async () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    act(() => {
      result.current.consumeSpellSlot(1);
    });

    expect(result.current.spellSlots[1]?.used).toBe(1);

    act(() => {
      result.current.restoreSpellSlot(1);
    });

    expect(result.current.spellSlots[1]?.used).toBe(0);
  });

  it('should handle pact magic and sorcery points', () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    act(() => {
      result.current.consumePactSlot();
    });
    expect(result.current.pactSlots.current).toBe(0);

    act(() => {
      result.current.spendSorceryPoints(2);
    });
    expect(result.current.sorceryPoints.current).toBe(1);
  });

  it('should handle rest mechanics', async () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    act(() => {
      result.current.consumeSpellSlot(1);
      result.current.spendSorceryPoints(1);
    });

    expect(result.current.spellSlots[1]?.used).toBe(1);
    expect(result.current.sorceryPoints.current).toBe(2);

    act(() => {
      result.current.longRest();
    });

    expect(result.current.spellSlots[1]?.used).toBe(0);
    expect(result.current.sorceryPoints.current).toBe(5);
  });

  it('should detect spellcasting features', () => {
    const { result } = renderHook(() => useEnhancedSpellcasting(mockCharacter));

    expect(result.current.hasSpellcasting).toBe(true);
    expect(result.current.hasMetamagic).toBe(true);
    expect(result.current.canCastRituals).toBe(true);
    expect(result.current.availableMetamagic).toHaveLength(1);
    expect(result.current.availableMetamagic[0]?.id).toBe('careful-spell');
  });
});
