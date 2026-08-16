import { describe, it, expect, vi } from 'vitest';

import {
  parseJsonField,
  parseSpellListField,
  transformAbilityScores,
  transformCharacterData,
  type CharacterRow,
  type CharacterStatsRow,
  type CharacterEquipmentRow
} from '../data-transformers';

// Mock logger to avoid console noise during tests
vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import logger from '@/lib/logger';

describe('data-transformers', () => {
  describe('parseJsonField', () => {
    it('should parse valid JSON', () => {
      const input = '{"a": 1, "b": [1, 2]}';
      const result = parseJsonField(input, {});
      expect(result).toEqual({ a: 1, b: [1, 2] });
    });

    it('should return fallback for invalid JSON and log a warning', () => {
      const input = '{invalid-json}';
      const fallback = { error: true };
      const result = parseJsonField(input, fallback);
      expect(result).toEqual(fallback);
      expect(logger.warn).toHaveBeenCalledWith('Failed to parse character JSON field', expect.objectContaining({ raw: input }));
    });

    it('should return fallback for null or undefined input', () => {
      expect(parseJsonField(null, 'fallback')).toBe('fallback');
      expect(parseJsonField(undefined, 'fallback')).toBe('fallback');
    });
  });

  describe('parseSpellListField', () => {
    it('should parse JSON array strings', () => {
      const input = '["magic-missile", "shield"]';
      const result = parseSpellListField(input);
      expect(result).toEqual(['magic-missile', 'shield']);
    });

    it('should parse legacy comma-separated strings', () => {
      const input = 'magic-missile, shield , fire-bolt';
      const result = parseSpellListField(input);
      expect(result).toEqual(['magic-missile', 'shield', 'fire-bolt']);
    });

    it('should handle empty strings or null', () => {
      expect(parseSpellListField('')).toEqual([]);
      expect(parseSpellListField(null)).toEqual([]);
      expect(parseSpellListField('   ')).toEqual([]);
    });

    it('should filter out empty strings from comma-separated lists', () => {
      const input = 'magic-missile, , shield,';
      const result = parseSpellListField(input);
      expect(result).toEqual(['magic-missile', 'shield']);
    });

    it('should handle non-array JSON or invalid bracketed strings by falling back to comma split', () => {
      // Case 1: Doesn't start with '['
      const input1 = '{"not": "an array"}';
      const result1 = parseSpellListField(input1);
      expect(result1).toEqual(['{"not": "an array"}']);

      // Case 2: Starts with '[' but invalid JSON
      const input2 = '[invalid]';
      const result2 = parseSpellListField(input2);
      expect(result2).toEqual(['[invalid]']);
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('transformAbilityScores', () => {
    it('should calculate modifiers correctly', () => {
      const stats: CharacterStatsRow = {
        strength: 15, // +2
        dexterity: 14, // +2
        constitution: 10, // +0
        intelligence: 8,  // -1
        wisdom: 12, // +1
        charisma: 20, // +5
      };

      const result = transformAbilityScores(stats);
      expect(result?.strength).toEqual({ score: 15, modifier: 2, savingThrow: false });
      expect(result?.intelligence).toEqual({ score: 8, modifier: -1, savingThrow: false });
      expect(result?.charisma).toEqual({ score: 20, modifier: 5, savingThrow: false });
    });

    it('should return null if stats are missing', () => {
      expect(transformAbilityScores(null)).toBeNull();
      expect(transformAbilityScores(undefined)).toBeNull();
    });
  });

  describe('transformCharacterData', () => {
    const mockCharacterRow: CharacterRow = {
      id: 'char-123',
      user_id: 'user-456',
      name: 'Grog',
      race: 'Goliath',
      class: 'Barbarian',
      level: 5,
      experience_points: 6500,
      alignment: 'Chaotic Neutral',
      vision_types: '["darkvision"]',
      cantrips: '[]',
      known_spells: '["rage"]',
      prepared_spells: null,
      ritual_spells: null,
    };

    const mockStats: CharacterStatsRow = {
      strength: 18,
      dexterity: 12,
      constitution: 16,
      intelligence: 7,
      wisdom: 11,
      charisma: 10,
    };

    const mockEquipment: CharacterEquipmentRow[] = [
      {
        id: 'item-1',
        item_name: 'Greatsword',
        quantity: 1,
        equipped: true,
        is_magic: false
      },
      {
        id: 'item-2',
        item_name: 'Ring of Protection',
        quantity: 1,
        equipped: true,
        is_magic: true,
        magic_bonus: 1,
        magic_properties: '["warding"]',
        requires_attunement: true,
        is_attuned: true,
        magic_item_type: 'ring',
        magic_item_rarity: 'rare',
        magic_effects: '{"ac": 1}'
      }
    ];

    it('should transform full database data into a Character object', () => {
      const equipmentWithMissingFields: CharacterEquipmentRow[] = [
        ...mockEquipment,
        {
          id: 'item-3',
          item_name: 'Dagger',
          // quantity, equipped missing
        }
      ];
      const character = transformCharacterData(mockCharacterRow, mockStats, equipmentWithMissingFields);

      expect(character.id).toBe('char-123');
      expect(character.name).toBe('Grog');
      expect(character.race.name).toBe('Goliath');
      expect(character.class.name).toBe('Barbarian');
      expect(character.level).toBe(5);
      expect(character.abilityScores.strength.score).toBe(18);
      expect(character.abilityScores.strength.modifier).toBe(4);
      expect(character.equipment).toContain('Greatsword');
      expect(character.equipment).toContain('Ring of Protection');

      // Check inventory mapping
      expect(character.inventory).toHaveLength(3);
      const ring = character.inventory.find(i => i.itemId === 'item-2');
      expect(ring?.isMagic).toBe(true);
      expect(ring?.magicBonus).toBe(1);
      expect(ring?.magicProperties).toEqual(['warding']);
      expect(ring?.magicEffects).toEqual({ ac: 1 });
      expect(ring?.isAttuned).toBe(true);

      const dagger = character.inventory.find(i => i.itemId === 'item-3');
      expect(dagger?.quantity).toBe(1);
      expect(dagger?.equipped).toBe(false);

      expect(character.visionTypes).toEqual(['darkvision']);
    });

    it('should handle missing stats and equipment with defaults', () => {
      const minimalRow: CharacterRow = {
        ...mockCharacterRow,
        experience_points: null,
        alignment: null,
        cantrips: null,
        known_spells: null,
      };

      const character = transformCharacterData(minimalRow, null, null);

      expect(character.abilityScores.strength.score).toBe(10);
      expect(character.equipment).toEqual([]);
      expect(character.inventory).toEqual([]);
      expect(character.cantrips).toEqual([]);
      expect(character.experience).toBe(0);
      expect(character.alignment).toBe('');
    });

    it('should handle legacy CSV spell lists during full transformation', () => {
      const legacyRow: CharacterRow = {
        ...mockCharacterRow,
        cantrips: 'mage-hand, light',
        known_spells: 'shield, magic-missile',
      };

      const character = transformCharacterData(legacyRow, mockStats, []);
      expect(character.cantrips).toEqual(['mage-hand', 'light']);
      expect(character.knownSpells).toEqual(['shield', 'magic-missile']);
    });

    // Issue #1827: the character sheet page hydrates through this transformer,
    // which dropped every proficiency column — so the sheet showed bare
    // ability modifiers on skills and saves.
    describe('proficiency columns', () => {
      const monkRow: CharacterRow = {
        ...mockCharacterRow,
        class: 'Monk',
        background: 'Sage',
        skill_proficiencies: 'Arcana,History,Acrobatics,Athletics',
        saving_throw_proficiencies: 'strength,dexterity',
        tool_proficiencies: 'Flute',
        expertise_proficiencies: null,
        languages: ['Common', 'Giant'],
      };

      it('hydrates the persisted proficiencies', () => {
        const character = transformCharacterData(monkRow, mockStats, []);

        expect(character.skillProficiencies).toEqual([
          'Arcana',
          'History',
          'Acrobatics',
          'Athletics',
        ]);
        expect(character.savingThrowProficiencies).toEqual(['strength', 'dexterity']);
        expect(character.toolProficiencies).toEqual(['Flute']);
        expect(character.languages).toEqual(['Common', 'Giant']);
      });

      it('leaves an empty column undefined so the class fallback still applies', () => {
        const character = transformCharacterData(monkRow, mockStats, []);

        expect(character.expertiseProficiencies).toBeUndefined();
      });
    });
  });
});
