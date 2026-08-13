import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/services/spell-progression-data', async (importOriginal) => {
  const actual = await importOriginal<typeof SpellProgressionDataModule>();
  return {
    ...actual,
    spellcastingClasses: [
      ...actual.spellcastingClasses,
      {
        id: 'paladin',
        name: 'Paladin',
        spellcasting_ability: 'Charisma',
        caster_type: 'half',
        spell_slots_start_level: 2,
      },
      {
        id: 'arcane-trickster',
        name: 'Arcane Trickster',
        spellcasting_ability: 'Intelligence',
        caster_type: 'third',
        spell_slots_start_level: 3,
      },
    ],
  };
});

vi.mock('@/data/spellOptions', () => ({
  allSpells: [
    {
      id: 'fireball',
      name: 'Fireball',
      level: 3,
      school: 'Evocation',
      ritual: false,
      concentration: false,
      castingTime: '1 action',
      range: '150 feet',
      duration: 'Instantaneous',
      description: 'A bright streak...',
    },
    {
      id: 'cure-wounds',
      name: 'Cure Wounds',
      level: 1,
      school: 'Evocation',
      ritual: false,
      concentration: false,
      castingTime: '1 action',
      range: 'Touch',
      duration: 'Instantaneous',
      description: 'A creature you touch...',
    },
    {
      id: 'detect-magic',
      name: 'Detect Magic',
      level: 1,
      school: 'Divination',
      ritual: true,
      concentration: true,
      castingTime: '1 action',
      range: 'Self',
      duration: 'Concentration, up to 10 minutes',
      description: 'For the duration...',
    },
  ],
  getClassSpells: vi.fn((className: string) => {
    if (className === 'Wizard') {
      return {
        cantrips: [],
        spells: [
          { id: 'fireball', name: 'Fireball', level: 3 },
          { id: 'detect-magic', name: 'Detect Magic', level: 1 },
        ],
      };
    }
    return { cantrips: [], spells: [] };
  }),
}));

import { localSpellService } from '../localSpellService';

import type * as SpellProgressionDataModule from '@/services/spell-progression-data';

import { allSpells, getClassSpells } from '@/data/spellOptions';

describe('LocalSpellService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAllSpells', () => {
    it('should return all spells when no filters are provided', async () => {
      const spells = await localSpellService.getAllSpells();
      expect(spells).toHaveLength(allSpells.length);
      expect(spells).toEqual(allSpells);
    });

    it('should filter by level', async () => {
      const spells = await localSpellService.getAllSpells({ level: 1 });
      expect(spells).toHaveLength(2);
      expect(spells.every((s) => s.level === 1)).toBe(true);
    });

    it('should filter by school', async () => {
      const spells = await localSpellService.getAllSpells({ school: 'Divination' });
      expect(spells).toHaveLength(1);
      expect(spells[0].id).toBe('detect-magic');
    });

    it('should filter by ritual', async () => {
      const spells = await localSpellService.getAllSpells({ ritual: true });
      expect(spells).toHaveLength(1);
      expect(spells[0].id).toBe('detect-magic');
    });

    it('should filter by class', async () => {
      const spells = await localSpellService.getAllSpells({ class: 'Wizard' });
      // getClassSpells for Wizard returns fireball and detect-magic
      expect(spells).toHaveLength(2);
      expect(spells.map((s) => s.id)).toContain('fireball');
      expect(spells.map((s) => s.id)).toContain('detect-magic');
      expect(getClassSpells).toHaveBeenCalledWith('Wizard');
    });

    it('should combine multiple filters', async () => {
      const spells = await localSpellService.getAllSpells({ level: 1, ritual: true });
      expect(spells).toHaveLength(1);
      expect(spells[0].id).toBe('detect-magic');
    });
  });

  describe('getClassSpells', () => {
    it('should return cantrips and spells for a class', async () => {
      const result = await localSpellService.getClassSpells('Wizard');
      expect(getClassSpells).toHaveBeenCalledWith('Wizard');
      expect(result.spells).toHaveLength(2);
      expect(result.spells[0].id).toBe('fireball');
    });
  });

  describe('getSpellProgression', () => {
    it('should return progression for a known class', async () => {
      const progression = await localSpellService.getSpellProgression('Wizard');
      expect(progression).toBeDefined();
      expect(progression.length).toBeGreaterThan(0);
      expect(progression[0].character_level).toBe(1);
    });

    it('should return empty array for an unknown class', async () => {
      const progression = await localSpellService.getSpellProgression('UnknownClass');
      expect(progression).toEqual([]);
    });
  });

  describe('getMulticlassSpellSlots', () => {
    it('should return correct slots for level 1-5', async () => {
      const level1 = await localSpellService.getMulticlassSpellSlots(1);
      expect(level1.spell_slots_1).toBe(2);

      const level3 = await localSpellService.getMulticlassSpellSlots(3);
      expect(level3.spell_slots_1).toBe(4);
      expect(level3.spell_slots_2).toBe(2);

      const level5 = await localSpellService.getMulticlassSpellSlots(5);
      expect(level5.spell_slots_1).toBe(4);
      expect(level5.spell_slots_2).toBe(3);
      expect(level5.spell_slots_3).toBe(2);
    });

    it('should fallback to level 1 for unknown levels (current implementation behavior)', async () => {
      const level6 = await localSpellService.getMulticlassSpellSlots(6);
      expect(level6.caster_level).toBe(1);
      expect(level6.spell_slots_1).toBe(2);
    });

    it('should return level 1 slots for level 0 or negative (current implementation behavior)', async () => {
      const level0 = await localSpellService.getMulticlassSpellSlots(0);
      expect(level0.caster_level).toBe(1);
    });
  });

  describe('calculateMulticlassCasterLevel', () => {
    it('should calculate level for full casters', async () => {
      const result = await localSpellService.calculateMulticlassCasterLevel([
        { className: 'Wizard', level: 2 },
        { className: 'Cleric', level: 1 },
      ]);
      expect(result.totalCasterLevel).toBe(3);
      expect(result.spellSlots?.caster_level).toBe(3);
      expect(result.pactMagicSlots).toBeNull();
    });

    it('should handle pact magic (Warlock)', async () => {
      const result = await localSpellService.calculateMulticlassCasterLevel([
        { className: 'Warlock', level: 3 },
      ]);
      expect(result.totalCasterLevel).toBe(0); // Pact magic doesn't add to caster level in this implementation
      expect(result.pactMagicSlots).toEqual({
        level: 2, // ceil(3/2) = 2
        slots: 2, // level 3 warlock has 2 slots
      });
    });

    it('should handle half and third casters', async () => {
      const result = await localSpellService.calculateMulticlassCasterLevel([
        { className: 'Paladin', level: 5 }, // floor(5/2) = 2
        { className: 'Arcane Trickster', level: 4 }, // floor(4/3) = 1
      ]);
      expect(result.totalCasterLevel).toBe(3);
    });

    it('should handle mixed caster types', async () => {
      const result = await localSpellService.calculateMulticlassCasterLevel([
        { className: 'Wizard', level: 3 },
        { className: 'Warlock', level: 2 },
      ]);
      expect(result.totalCasterLevel).toBe(3);
      expect(result.pactMagicSlots).toEqual({
        level: 1, // ceil(2/2) = 1
        slots: 2, // level 2 warlock has 2 slots
      });
    });

    it('should return null slots if total caster level is 0', async () => {
      const result = await localSpellService.calculateMulticlassCasterLevel([
        { className: 'Fighter', level: 5 }, // Not a spellcasting class in the map
      ]);
      expect(result.totalCasterLevel).toBe(0);
      expect(result.spellSlots).toBeNull();
      expect(result.pactMagicSlots).toBeNull();
    });
  });

  describe('getSpellById', () => {
    it('should return a spell by ID', async () => {
      const spell = await localSpellService.getSpellById('fireball');
      expect(spell.name).toBe('Fireball');
    });

    it('should throw error for non-existent spell', async () => {
      await expect(localSpellService.getSpellById('non-existent')).rejects.toThrow(
        'Spell with ID non-existent not found',
      );
    });
  });

  describe('getSpellcastingClasses', () => {
    it('should return the list of spellcasting classes', async () => {
      const classes = await localSpellService.getSpellcastingClasses();
      expect(classes).toBeDefined();
      expect(classes.length).toBeGreaterThan(0);
      expect(classes.some((c) => c.name === 'Wizard')).toBe(true);
    });
  });
});
