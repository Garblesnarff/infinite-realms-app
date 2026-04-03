/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  getMagicAttackBonus,
  getMagicDamageBonus,
  getMagicACBonus,
  getMagicSaveBonus,
  getMagicAbilityBonuses,
  getMagicSpecialProperties,
  getMagicSpellEffects,
  hasEquippedMagicItem,
  canAttuneToItem,
  getAttunedItemCount,
  canAttuneToMoreItems,
  validateAttunementRequirements,
  isMagicItemActive,
  parseAttunementRequirements,
  getMagicItemById,
  applyMagicItemEffectsToParticipant,
} from '../magicItemEffects';

import type { Character } from '@/types/character';

describe('magicItemEffects', () => {
  const mockCharacter: Partial<Character> = {
    class: { name: 'Wizard' } as any,
    race: { name: 'Elf' } as any,
    alignment: 'Neutral Good',
    inventory: [
      {
        itemId: 'longsword-plus-1',
        quantity: 1,
        equipped: true,
        isMagic: true,
        magicItemType: 'weapon',
        magicBonus: 1,
        magicEffects: {
          attackBonus: 1,
          damageBonus: 1,
        },
      },
      {
        itemId: 'ring-of-protection',
        quantity: 1,
        equipped: true,
        isMagic: true,
        magicItemType: 'ring',
        magicBonus: 1,
        isAttuned: true,
        requiresAttunement: true,
        magicEffects: {
          acBonus: 1,
          saveBonus: 1,
        },
      },
    ] as any,
  };

  describe('Combat Bonuses', () => {
    it('should calculate total attack bonus', () => {
      expect(getMagicAttackBonus(mockCharacter as Character)).toBe(1);
    });

    it('should calculate total damage bonus', () => {
      expect(getMagicDamageBonus(mockCharacter as Character)).toBe(1);
    });

    it('should calculate total AC bonus', () => {
      expect(getMagicACBonus(mockCharacter as Character)).toBe(1);
    });

    it('should calculate total save bonus', () => {
      expect(getMagicSaveBonus(mockCharacter as Character)).toBe(1);
    });

    it('should return 0 when inventory is missing', () => {
      const char: any = {};
      expect(getMagicAttackBonus(char)).toBe(0);
      expect(getMagicDamageBonus(char)).toBe(0);
      expect(getMagicACBonus(char)).toBe(0);
      expect(getMagicSaveBonus(char)).toBe(0);
    });

    it('should only count equipped items', () => {
      const char: any = {
        inventory: [
          {
            equipped: false,
            isMagic: true,
            magicBonus: 1,
            magicEffects: { attackBonus: 1 },
          },
        ],
      };
      expect(getMagicAttackBonus(char)).toBe(0);
    });

    it('should only count magic items', () => {
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: false,
            magicBonus: 1,
            magicEffects: { attackBonus: 1 },
          },
        ],
      };
      expect(getMagicAttackBonus(char)).toBe(0);
    });

    it('should handle items with missing magicEffects but having magicBonus for weapons', () => {
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: true,
            magicItemType: 'weapon',
            magicBonus: 2,
          },
        ],
      };
      expect(getMagicAttackBonus(char)).toBe(2);
    });

    it('should count items even if magicBonus is 0 but specific effect is present', () => {
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: true,
            magicBonus: 0,
            magicEffects: { saveBonus: 1 },
          },
        ],
      };
      expect(getMagicSaveBonus(char)).toBe(1);
    });
  });

  describe('Ability & Special Properties', () => {
    it('should aggregate ability bonuses', () => {
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: true,
            magicEffects: {
              abilityScoreBonus: { ability: 'strength', bonus: 2 },
            },
          },
          {
            equipped: true,
            isMagic: true,
            magicEffects: {
              abilityScoreBonus: { ability: 'strength', bonus: 1 },
            },
          },
        ],
      };
      const bonuses = getMagicAbilityBonuses(char);
      expect(bonuses.strength).toBe(3);
    });

    it('should aggregate special properties', () => {
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: true,
            magicEffects: { specialProperties: ['Darkvision'] },
          },
          {
            equipped: true,
            isMagic: true,
            magicEffects: { specialProperties: ['Resistance to Fire'] },
          },
        ],
      };
      const props = getMagicSpecialProperties(char);
      expect(props).toContain('Darkvision');
      expect(props).toContain('Resistance to Fire');
    });

    it('should aggregate spell effects', () => {
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: true,
            magicEffects: {
              spellEffects: [{ spellName: 'Fireball', charges: 3 }],
            },
          },
        ],
      };
      const spells = getMagicSpellEffects(char);
      expect(spells[0].spellName).toBe('Fireball');
    });
  });

  describe('Attunement Logic', () => {
    it('should correctly count attuned items', () => {
      expect(getAttunedItemCount(mockCharacter as Character)).toBe(1);
    });

    it('should check if more items can be attuned', () => {
      expect(canAttuneToMoreItems(mockCharacter as Character)).toBe(true);

      const fullChar: any = {
        inventory: [{ isAttuned: true }, { isAttuned: true }, { isAttuned: true }],
      };
      expect(canAttuneToMoreItems(fullChar)).toBe(false);
    });

    it('should validate class requirements', () => {
      const item = { attunementRequirements: 'class:Wizard' };
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);

      const fighter: any = { class: { name: 'Fighter' } };
      expect(canAttuneToItem(fighter, item)).toBe(false);
    });

    it('should fail attunement if class is missing but required', () => {
      const item = { attunementRequirements: 'class:Wizard' };
      const noClass: any = { class: null };
      expect(canAttuneToItem(noClass, item)).toBe(false);
    });

    it('should validate race requirements', () => {
      const item = { attunementRequirements: 'race:Elf' };
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);

      const dwarf: any = { race: { name: 'Dwarf' } };
      expect(canAttuneToItem(dwarf, item)).toBe(false);
    });

    it('should fail attunement if race is missing but required', () => {
      const item = { attunementRequirements: 'race:Elf' };
      const noRace: any = { race: null };
      expect(canAttuneToItem(noRace, item)).toBe(false);
    });

    it('should validate alignment requirements', () => {
      const item = { attunementRequirements: 'alignment:Neutral Good' };
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);

      const evil: any = { alignment: 'Chaotic Evil' };
      expect(canAttuneToItem(evil, item)).toBe(false);
    });

    it('should fail attunement if alignment is missing but required', () => {
      const item = { attunementRequirements: 'alignment:Neutral Good' };
      const noAlign: any = { alignment: null };
      expect(canAttuneToItem(noAlign, item)).toBe(false);
    });

    it('should handle OR requirements in attunement', () => {
      const item = { attunementRequirements: 'class:Wizard | Cleric' };
      const wizard: any = { class: { name: 'Wizard' } };
      const cleric: any = { class: { name: 'Cleric' } };
      expect(canAttuneToItem(wizard, item)).toBe(true);
      expect(canAttuneToItem(cleric, item)).toBe(true);
    });

    it('should validate multiple requirements (validateAttunementRequirements)', () => {
      const item = {
        requiresAttunement: true,
        attunementRequirements: 'class:Wizard, race:Elf',
      };
      const result = validateAttunementRequirements(mockCharacter as Character, item);
      expect(result.canAttune).toBe(true);

      const humanWizard: any = {
        class: { name: 'Wizard' },
        race: { name: 'Human' },
        inventory: [],
      };
      const result2 = validateAttunementRequirements(humanWizard, item);
      expect(result2.canAttune).toBe(false);
      expect(result2.reason).toContain('race');
    });

    it('should fail validation if alignment is missing in validateAttunementRequirements', () => {
      const item = {
        requiresAttunement: true,
        attunementRequirements: 'alignment:Lawful Good',
      };
      const noAlign: any = { alignment: null, inventory: [] };
      const result = validateAttunementRequirements(noAlign, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('alignment');
    });

    it('should fail validation if alignment is wrong in validateAttunementRequirements', () => {
      const item = {
        requiresAttunement: true,
        attunementRequirements: 'alignment:Lawful Good',
      };
      const evil: any = { alignment: 'Chaotic Evil', inventory: [] };
      const result = validateAttunementRequirements(evil, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('alignment');
    });

    it('should fail validation if race is missing in validateAttunementRequirements', () => {
      const item = {
        requiresAttunement: true,
        attunementRequirements: 'race:Elf',
      };
      const noRace: any = { race: null, inventory: [] };
      const result = validateAttunementRequirements(noRace, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('race');
    });

    it('should fail validation if race is wrong in validateAttunementRequirements', () => {
      const item = {
        requiresAttunement: true,
        attunementRequirements: 'race:Elf',
      };
      const dwarf: any = { race: { name: 'Dwarf' }, inventory: [] };
      const result = validateAttunementRequirements(dwarf, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('race');
    });

    it('should fail validation if class is missing in validateAttunementRequirements', () => {
      const item = {
        requiresAttunement: true,
        attunementRequirements: 'class:Wizard',
      };
      const noClass: any = { class: null, inventory: [] };
      const result = validateAttunementRequirements(noClass, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('class');
    });
  });

  describe('applyMagicItemEffectsToParticipant', () => {
    it('should apply AC bonus to participant', () => {
      const participant: any = { armorClass: 10 };
      const char: any = {
        inventory: [
          {
            equipped: true,
            isMagic: true,
            magicEffects: { acBonus: 2 },
          },
        ],
      };
      const result = applyMagicItemEffectsToParticipant(participant, char);
      expect(result.armorClass).toBe(12);
    });

    it('should handle zero bonuses', () => {
      const participant: any = { armorClass: 10 };
      const char: any = { inventory: [] };
      const result = applyMagicItemEffectsToParticipant(participant, char);
      expect(result.armorClass).toBe(10);
    });
  });

  describe('Utility Functions', () => {
    it('should find magic item by id', () => {
      const item = getMagicItemById(mockCharacter as Character, 'longsword-plus-1');
      expect(item).not.toBeNull();
      expect(item?.itemId).toBe('longsword-plus-1');
    });

    it('should check if magic item is active', () => {
      expect(isMagicItemActive(mockCharacter as Character, 'longsword-plus-1')).toBe(true);
      expect(isMagicItemActive(mockCharacter as Character, 'ring-of-protection')).toBe(true);

      const char: any = {
        inventory: [
          {
            itemId: 'inactive-item',
            equipped: false,
            isMagic: true,
          },
          {
            itemId: 'unattuned-item',
            equipped: true,
            isMagic: true,
            requiresAttunement: true,
            isAttuned: false,
          },
        ],
      };
      expect(isMagicItemActive(char, 'inactive-item')).toBe(false);
      expect(isMagicItemActive(char, 'unattuned-item')).toBe(false);
    });

    it('should parse attunement requirements string', () => {
      const reqs = 'class:Wizard, race:Elf | Dwarf';
      const parsed = parseAttunementRequirements(reqs);
      expect(parsed).toHaveLength(3);
      expect(parsed).toContain('class:Wizard');
      expect(parsed).toContain('race:Elf');
      expect(parsed).toContain('Dwarf');
    });

    it('should check if character has a specific magic item equipped', () => {
      expect(hasEquippedMagicItem(mockCharacter as Character, 'Longsword')).toBe(true);
      expect(hasEquippedMagicItem(mockCharacter as Character, 'Shield')).toBe(false);
    });
  });
});
