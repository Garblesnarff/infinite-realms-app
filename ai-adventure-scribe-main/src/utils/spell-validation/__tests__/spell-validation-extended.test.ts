import { describe, it, expect, beforeEach } from 'vitest';

import type { Character, CharacterClass, CharacterRace, Subrace } from '@/types/character';

import {
  validateSpellSelection,
  getSpellcastingInfo,
  getRacialSpells,
} from '@/utils/spell-validation';

describe('Spell Validation Extended', () => {
  let mockCleric: CharacterClass;
  let mockPaladin: CharacterClass;
  let mockFighter: CharacterClass;
  let mockRace: CharacterRace;
  let mockTieflingSubrace: Subrace;

  beforeEach(() => {
    mockCleric = {
      id: 'cleric',
      name: 'Cleric',
      hitDie: 8,
      primaryAbility: 'wisdom',
      savingThrowProficiencies: ['wisdom', 'charisma'],
      skillChoices: [],
      numSkillChoices: 2,
      spellcasting: {
        ability: 'wisdom',
        cantripsKnown: 3,
      },
      classFeatures: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    };

    mockPaladin = {
      id: 'paladin',
      name: 'Paladin',
      hitDie: 10,
      primaryAbility: 'charisma',
      savingThrowProficiencies: ['wisdom', 'charisma'],
      skillChoices: [],
      numSkillChoices: 2,
      spellcasting: {
        ability: 'charisma',
        cantripsKnown: 0,
      },
      classFeatures: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    };

    mockFighter = {
      id: 'fighter',
      name: 'Fighter',
      hitDie: 10,
      primaryAbility: 'strength',
      savingThrowProficiencies: ['strength', 'constitution'],
      skillChoices: [],
      numSkillChoices: 2,
      classFeatures: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    };

    mockRace = {
      id: 'human',
      name: 'Human',
      description: 'Versatile',
      abilityScoreIncrease: {},
      speed: 30,
      traits: [],
      languages: ['Common'],
    };

    mockTieflingSubrace = {
      id: 'tiefling',
      name: 'Tiefling',
      description: 'Fiendish',
      abilityScoreIncrease: { charisma: 2 },
      traits: ['Infernal Legacy'],
    };
  });

  describe('Level-dependent Spellcasting Info', () => {
    it('should support Paladin spellcasting at level 2', () => {
      const info = getSpellcastingInfo(mockPaladin, 2);
      expect(info).not.toBeNull();
      expect(info?.spellsPrepared).toBeGreaterThan(0);
    });

    it('should scale Cleric prepared spells with level', () => {
      const infoLvl1 = getSpellcastingInfo(mockCleric, 1);
      const infoLvl5 = getSpellcastingInfo(mockCleric, 5);

      expect(infoLvl5?.spellsPrepared).toBeGreaterThan(infoLvl1?.spellsPrepared || 0);
    });
  });

  describe('Level-dependent Racial Spells', () => {
    it('should unlock Tiefling Hellish Rebuke at level 3', () => {
      const spellsLvl1 = getRacialSpells('Tiefling', mockTieflingSubrace, 1);
      const spellsLvl3 = getRacialSpells('Tiefling', mockTieflingSubrace, 3);

      expect(spellsLvl1.spells).not.toContain('hellish-rebuke');
      expect(spellsLvl3.spells).toContain('hellish-rebuke');
    });

    it('should unlock Tiefling Darkness at level 5', () => {
      const spellsLvl5 = getRacialSpells('Tiefling', mockTieflingSubrace, 5);
      expect(spellsLvl5.spells).toContain('darkness');
    });
  });

  describe('Prepared Spell Validation', () => {
    it('should validate Cleric prepared spell count', () => {
      const clericChar: Character = {
        name: 'Test Cleric',
        level: 1,
        class: mockCleric,
        race: mockRace,
        abilityScores: {
          wisdom: { score: 16, modifier: 3 },
        } as unknown as Character['abilityScores'],
      };

      // Cleric at lvl 1 with +3 Wis should have 4 prepared spells
      const result = validateSpellSelection(
        clericChar,
        ['guidance', 'light-cleric', 'resistance'],
        ['cure-wounds', 'guiding-bolt', 'bless', 'shield-of-faith']
      );

      expect(result.valid).toBe(true);

      const tooMany = validateSpellSelection(
        clericChar,
        ['guidance', 'light-cleric', 'resistance'],
        ['cure-wounds', 'guiding-bolt', 'bless', 'shield-of-faith', 'command']
      );
      expect(tooMany.valid).toBe(false);
      expect(tooMany.errors.some(e => e.type === 'COUNT_MISMATCH')).toBe(true);
    });
  });

  describe('Racial Spell Validation for Non-Spellcasters', () => {
    it('should validate level 3 Tiefling Fighter with racial spells', () => {
      const fighterChar: Character = {
        name: 'Tiefling Fighter',
        level: 3,
        class: mockFighter,
        race: { name: 'Tiefling' } as any,
        subrace: mockTieflingSubrace,
      };

      // At lvl 3, Tiefling has Thaumaturgy (cantrip) and Hellish Rebuke (spell)
      const result = validateSpellSelection(
        fighterChar,
        ['thaumaturgy'],
        ['hellish-rebuke']
      );
      expect(result.valid).toBe(true);

      const missingSpell = validateSpellSelection(
        fighterChar,
        ['thaumaturgy'],
        []
      );
      expect(missingSpell.valid).toBe(false);
      expect(missingSpell.errors.some(e => e.type === 'COUNT_MISMATCH')).toBe(true);
    });

    it('should reject non-spellcaster level 1 Human Fighter with spells', () => {
        const fighterChar: Character = {
          name: 'Human Fighter',
          level: 1,
          class: mockFighter,
          race: mockRace,
        };

        const result = validateSpellSelection(
          fighterChar,
          ['mage-hand'],
          ['magic-missile']
        );
        expect(result.valid).toBe(false);
        expect(result.errors.some(e => e.type === 'LEVEL_REQUIREMENT')).toBe(true);
      });
  });
});
