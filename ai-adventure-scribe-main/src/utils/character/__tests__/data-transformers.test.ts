import { describe, it, expect, vi } from 'vitest';

import { SRD_CLASS_TABLE } from '../../../../shared/srd-class-data';
import {
  findUnresolvedCharacterData,
  parseJsonField,
  parseSpellListField,
  transformAbilityScores,
  transformCharacterData,
  type CharacterRow,
  type CharacterStatsRow,
  type CharacterEquipmentRow,
} from '../data-transformers';

import { backgrounds } from '@/data/backgroundOptions';
import { classes } from '@/data/classes';
import { races } from '@/data/races';
import logger from '@/lib/logger';
import { calculateHitPoints } from '@/utils/character/basic-math';

// Mock logger to avoid console noise during tests
vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

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
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to parse character JSON field',
        expect.objectContaining({ raw: input }),
      );
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
        intelligence: 8, // -1
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
      race: 'Forest Giant',
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
        is_magic: false,
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
        magic_effects: '{"ac": 1}',
      },
    ];

    it('should transform full database data into a Character object', () => {
      const equipmentWithMissingFields: CharacterEquipmentRow[] = [
        ...mockEquipment,
        {
          id: 'item-3',
          item_name: 'Dagger',
          // quantity, equipped missing
        },
      ];
      const character = transformCharacterData(
        mockCharacterRow,
        mockStats,
        equipmentWithMissingFields,
      );

      expect(character.id).toBe('char-123');
      expect(character.name).toBe('Grog');
      expect(character.race?.name).toBe('Forest Giant');
      expect(character.class?.name).toBe('Barbarian');
      expect(character.level).toBe(5);
      expect(character.abilityScores.strength.score).toBe(18);
      expect(character.abilityScores.strength.modifier).toBe(4);
      expect(character.equipment).toContain('Greatsword');
      expect(character.equipment).toContain('Ring of Protection');

      // Check inventory mapping
      expect(character.inventory).toHaveLength(3);
      const ring = character.inventory.find((i) => i.itemId === 'item-2');
      expect(ring?.isMagic).toBe(true);
      expect(ring?.magicBonus).toBe(1);
      expect(ring?.magicProperties).toEqual(['warding']);
      expect(ring?.magicEffects).toEqual({ ac: 1 });
      expect(ring?.isAttuned).toBe(true);

      const dagger = character.inventory.find((i) => i.itemId === 'item-3');
      expect(dagger?.quantity).toBe(1);
      expect(dagger?.equipped).toBe(false);

      expect(character.visionTypes).toEqual(['darkvision']);
    });

    describe('canonical race, class, and background hydration', () => {
      it('covers the same twelve classes as the frontend class records', () => {
        expect(SRD_CLASS_TABLE.map((entry) => entry.name).sort()).toEqual(
          classes.map((entry) => entry.name).sort(),
        );
      });

      for (const expectedClass of SRD_CLASS_TABLE) {
        it(`hydrates the full ${expectedClass.name} class record`, () => {
          const character = transformCharacterData(
            {
              ...mockCharacterRow,
              race: 'Human',
              class: expectedClass.name,
              level: 1,
            },
            mockStats,
            [],
          );

          expect(character.class).toMatchObject({
            id: expectedClass.id,
            name: expectedClass.name,
            hitDie: expectedClass.hitDie,
            primaryAbility: expectedClass.primaryAbility,
            savingThrowProficiencies: [...expectedClass.savingThrowProficiencies],
          });
        });
      }

      for (const expectedRace of races) {
        it(`hydrates the full ${expectedRace.name} race record`, () => {
          const character = transformCharacterData(
            {
              ...mockCharacterRow,
              race: expectedRace.name,
              class: 'Wizard',
            },
            mockStats,
            [],
          );

          expect(character.race).toMatchObject({
            id: expectedRace.id,
            name: expectedRace.name,
            speed: expectedRace.speed,
            abilityScoreIncrease: expectedRace.abilityScoreIncrease,
            traits: expectedRace.traits,
            languages: expectedRace.languages,
          });
        });
      }

      it('hydrates a stored subrace from the selected race', () => {
        const character = transformCharacterData(
          {
            ...mockCharacterRow,
            race: 'dwarf',
            subrace: 'hill-dwarf',
            class: 'Wizard',
          },
          mockStats,
          [],
        );

        expect(character.race?.id).toBe('dwarf');
        expect(character.subrace).toMatchObject({
          id: 'hill-dwarf',
          name: 'Hill Dwarf',
          abilityScoreIncrease: { wisdom: 1 },
        });
      });

      it('hydrates the full background record', () => {
        const sage = backgrounds.find((background) => background.id === 'sage');
        const character = transformCharacterData(
          {
            ...mockCharacterRow,
            race: 'Human',
            class: 'Wizard',
            background: 'Sage',
          },
          mockStats,
          [],
        );

        expect(character.background).toBe(sage);
        expect(character.background).toMatchObject({
          id: 'sage',
          skillProficiencies: ['Arcana', 'History'],
          feature: { name: 'Researcher' },
        });
      });

      it('does not fabricate mechanics when a stored lookup is unknown', () => {
        vi.clearAllMocks();

        const character = transformCharacterData(
          {
            ...mockCharacterRow,
            race: 'Unknown Race',
            class: 'Unknown Class',
            background: 'Unknown Background',
          },
          mockStats,
          [],
        );

        // #2150: an unknown race/background keeps its stored name with default traits
        // (no bonuses, no proficiencies) instead of null, so the sheet never dereferences
        // null. An unknown class stays null: hit dice and spellcasting must not be guessed.
        expect(character.race).toEqual({
          id: 'unknown-unknownrace',
          name: 'Unknown Race',
          description: '',
          abilityScoreIncrease: {},
          speed: 30,
          traits: [],
          languages: [],
          subraces: [],
        });
        expect(character.class).toBeNull();
        expect(character.background).toMatchObject({
          name: 'Unknown Background',
          skillProficiencies: [],
          toolProficiencies: [],
          feature: { name: 'Unknown Background', description: '' },
        });
        expect(logger.warn).toHaveBeenCalledTimes(3);
      });

      it('resolves the premade-only Satyr race and backgrounds (#2150)', () => {
        const reveler = transformCharacterData(
          { ...mockCharacterRow, race: 'Satyr', class: 'Barbarian', background: 'Entertainer' },
          mockStats,
          [],
        );
        const pactBound = transformCharacterData(
          { ...mockCharacterRow, race: 'Tiefling', class: 'Warlock', background: 'Haunted One' },
          mockStats,
          [],
        );
        const seeker = transformCharacterData(
          { ...mockCharacterRow, race: 'Catfolk', class: 'Ranger', background: 'Anthropologist' },
          mockStats,
          [],
        );

        expect(reveler.race).toMatchObject({ id: 'satyr', name: 'Satyr', speed: 35 });
        expect(pactBound.background).toMatchObject({
          id: 'haunted-one',
          feature: { name: 'Heart of Darkness' },
        });
        expect(seeker.background).toMatchObject({
          id: 'anthropologist',
          feature: { name: 'Adept Linguist' },
        });
      });

      it('does not offer premade-only races and backgrounds in the creation wizard', () => {
        expect(races.some((race) => race.id === 'satyr')).toBe(false);
        expect(backgrounds.some((background) => background.id === 'haunted-one')).toBe(false);
      });
    });

    describe('findUnresolvedCharacterData', () => {
      it('names each stored value the client tables do not know', () => {
        expect(
          findUnresolvedCharacterData({
            race: 'Starborn Owlkin',
            subrace: 'Moonfeather',
            class: 'Chronomancer',
            background: 'Lighthouse Keeper',
          }),
        ).toEqual([
          'Unknown race: Starborn Owlkin',
          'Unknown class: Chronomancer',
          'Unknown background: Lighthouse Keeper',
        ]);
      });

      it('names an unknown subrace of a known race', () => {
        expect(
          findUnresolvedCharacterData({
            race: 'Elf',
            subrace: 'Moon Elf',
            class: 'Druid',
            background: 'Outlander',
          }),
        ).toEqual(['Unknown subrace: Moon Elf']);
      });

      it('is empty for every starter premade', () => {
        for (const premade of [
          { race: 'Satyr', subrace: null, class: 'Barbarian', background: 'Entertainer' },
          { race: 'Elf', subrace: 'Drow', class: 'Druid', background: 'Outlander' },
          { race: 'Tiefling', subrace: null, class: 'Warlock', background: 'Haunted One' },
          { race: 'Catfolk', subrace: null, class: 'Ranger', background: 'Anthropologist' },
          { race: 'Half-Elf', subrace: null, class: 'Bard', background: 'Entertainer' },
          { race: 'Halfling', subrace: null, class: 'Rogue', background: 'Charlatan' },
        ]) {
          expect(findUnresolvedCharacterData(premade)).toEqual([]);
        }
      });
    });

    describe('preview hit-point math', () => {
      it('calculates Wizard d6 plus CON at level 1 without treating it as sheet HP', () => {
        const character = transformCharacterData(
          {
            ...mockCharacterRow,
            race: 'Human',
            class: 'Wizard',
            level: 1,
          },
          { ...mockStats, constitution: 10 },
          [],
        );

        expect(character.class?.hitDie).toBe(6);
        expect(calculateHitPoints(character)).toBe(6);
      });

      it('calculates Barbarian d12 plus CON at level 1 without treating it as sheet HP', () => {
        const character = transformCharacterData(
          {
            ...mockCharacterRow,
            race: 'Human',
            class: 'Barbarian',
            level: 1,
          },
          { ...mockStats, constitution: 10 },
          [],
        );

        expect(character.class?.hitDie).toBe(12);
        expect(calculateHitPoints(character)).toBe(12);
      });
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
