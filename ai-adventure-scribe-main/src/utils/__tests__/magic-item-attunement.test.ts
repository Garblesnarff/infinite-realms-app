/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import {
  canAttuneToItem,
  getAttunedItemCount,
  canAttuneToMoreItems,
  getAttunedItems,
  validateAttunementRequirements,
  getMagicItemById,
  isMagicItemActive,
  parseAttunementRequirements,
} from '../magic-item-attunement';

import type { Character } from '@/types/character';

describe('magic-item-attunement', () => {
  const mockCharacter: Partial<Character> = {
    class: { name: 'Wizard' } as any,
    race: { name: 'Elf' } as any,
    alignment: 'Neutral Good',
    inventory: [
      {
        itemId: 'magic-sword',
        equipped: true,
        isMagic: true,
        requiresAttunement: true,
        isAttuned: true,
      },
      {
        itemId: 'bag-of-holding',
        equipped: true,
        isMagic: true,
        requiresAttunement: false,
        isAttuned: false,
      },
    ] as any,
  };

  describe('canAttuneToItem', () => {
    it('should return true if no requirements', () => {
      const item = {};
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);
    });

    it('should check class requirements', () => {
      const item = { attunementRequirements: 'class:Wizard' };
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);

      const fighter: any = { ...mockCharacter, class: { name: 'Fighter' } };
      expect(canAttuneToItem(fighter, item)).toBe(false);
    });

    it('should return false if class is missing but required', () => {
      const item = { attunementRequirements: 'class:Wizard' };
      const noClass: any = { ...mockCharacter, class: null };
      expect(canAttuneToItem(noClass, item)).toBe(false);
    });

    it('should check race requirements', () => {
      const item = { attunementRequirements: 'race:Elf' };
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);

      const dwarf: any = { ...mockCharacter, race: { name: 'Dwarf' } };
      expect(canAttuneToItem(dwarf, item)).toBe(false);
    });

    it('should return false if race is missing but required', () => {
      const item = { attunementRequirements: 'race:Elf' };
      const noRace: any = { ...mockCharacter, race: null };
      expect(canAttuneToItem(noRace, item)).toBe(false);
    });

    it('should check alignment requirements', () => {
      const item = { attunementRequirements: 'alignment:Neutral Good' };
      expect(canAttuneToItem(mockCharacter as Character, item)).toBe(true);

      const evil: any = { ...mockCharacter, alignment: 'Chaotic Evil' };
      expect(canAttuneToItem(evil, item)).toBe(false);
    });

    it('should return false if alignment is missing but required', () => {
      const item = { attunementRequirements: 'alignment:Neutral Good' };
      const noAlign: any = { ...mockCharacter, alignment: null };
      expect(canAttuneToItem(noAlign, item)).toBe(false);
    });

    it('should handle pipe separators in requirements', () => {
      const item = { attunementRequirements: 'class:Wizard|Sorcerer' };
      const wizard: any = { ...mockCharacter, class: { name: 'Wizard' } };
      const sorcerer: any = { ...mockCharacter, class: { name: 'Sorcerer' } };
      expect(canAttuneToItem(wizard, item)).toBe(true);
      expect(canAttuneToItem(sorcerer, item)).toBe(true);
    });
  });

  describe('getAttunedItemCount', () => {
    it('should return 0 if no inventory', () => {
      const char: any = {};
      expect(getAttunedItemCount(char)).toBe(0);
    });

    it('should count correctly', () => {
      expect(getAttunedItemCount(mockCharacter as Character)).toBe(1);
    });
  });

  describe('canAttuneToMoreItems', () => {
    it('should return true if under limit', () => {
      expect(canAttuneToMoreItems(mockCharacter as Character)).toBe(true);
    });

    it('should return false if at limit', () => {
      const fullChar: any = {
        inventory: [
          { isAttuned: true },
          { isAttuned: true },
          { isAttuned: true },
        ],
      };
      expect(canAttuneToMoreItems(fullChar)).toBe(false);
    });
  });

  describe('getAttunedItems', () => {
    it('should return array of attuned items', () => {
      const items = getAttunedItems(mockCharacter as Character);
      expect(items).toHaveLength(1);
      expect(items[0].itemId).toBe('magic-sword');
    });

    it('should return empty array if no inventory', () => {
      expect(getAttunedItems({} as any)).toEqual([]);
    });
  });

  describe('validateAttunementRequirements', () => {
    it('should return true if no attunement required', () => {
      const item = { requiresAttunement: false };
      const result = validateAttunementRequirements(mockCharacter as Character, item);
      expect(result.canAttune).toBe(true);
    });

    it('should fail if no slots left', () => {
      const item = { requiresAttunement: true };
      const fullChar: any = {
        inventory: [
          { isAttuned: true },
          { isAttuned: true },
          { isAttuned: true },
        ],
      };
      const result = validateAttunementRequirements(fullChar, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('maximum of 3');
    });

    it('should check class in validation', () => {
      const item = { requiresAttunement: true, attunementRequirements: 'class:Wizard' };
      const fighter: any = { ...mockCharacter, class: { name: 'Fighter' }, inventory: [] };
      const result = validateAttunementRequirements(fighter, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('class: wizard');
    });

    it('should check race in validation', () => {
      const item = { requiresAttunement: true, attunementRequirements: 'race:Elf' };
      const dwarf: any = { ...mockCharacter, race: { name: 'Dwarf' }, inventory: [] };
      const result = validateAttunementRequirements(dwarf, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('race: elf');
    });

    it('should check alignment in validation', () => {
      const item = { requiresAttunement: true, attunementRequirements: 'alignment:Neutral Good' };
      const evil: any = { ...mockCharacter, alignment: 'Chaotic Evil', inventory: [] };
      const result = validateAttunementRequirements(evil, item);
      expect(result.canAttune).toBe(false);
      expect(result.reason).toContain('alignment: neutral good');
    });

    it('should handle missing fields in validation', () => {
       const item = { requiresAttunement: true, attunementRequirements: 'class:Wizard, race:Elf, alignment:Good' };
       const empty: any = { inventory: [] };

       expect(validateAttunementRequirements(empty, { ...item, attunementRequirements: 'class:Wizard' }).reason).toContain('class');
       expect(validateAttunementRequirements(empty, { ...item, attunementRequirements: 'race:Elf' }).reason).toContain('race');
       expect(validateAttunementRequirements(empty, { ...item, attunementRequirements: 'alignment:Good' }).reason).toContain('alignment');
    });
  });

  describe('getMagicItemById', () => {
    it('should find item', () => {
      const item = getMagicItemById(mockCharacter as Character, 'magic-sword');
      expect(item?.itemId).toBe('magic-sword');
    });

    it('should return null if not found', () => {
      expect(getMagicItemById(mockCharacter as Character, 'non-existent')).toBeNull();
    });
  });

  describe('isMagicItemActive', () => {
    it('should return true for active item', () => {
      expect(isMagicItemActive(mockCharacter as Character, 'magic-sword')).toBe(true);
    });

    it('should return false if not equipped', () => {
      const char: any = {
        inventory: [{ itemId: 'sword', equipped: false, isMagic: true }],
      };
      expect(isMagicItemActive(char, 'sword')).toBe(false);
    });

    it('should return false if not attuned but required', () => {
      const char: any = {
        inventory: [{ itemId: 'sword', equipped: true, isMagic: true, requiresAttunement: true, isAttuned: false }],
      };
      expect(isMagicItemActive(char, 'sword')).toBe(false);
    });
  });

  describe('parseAttunementRequirements', () => {
    it('should parse correctly', () => {
      const reqs = 'class:Wizard, race:Elf | Dwarf & alignment:Good';
      const result = parseAttunementRequirements(reqs);
      expect(result).toContain('class:Wizard');
      expect(result).toContain('race:Elf');
      expect(result).toContain('Dwarf');
      expect(result).toContain('alignment:Good');
    });

    it('should return empty array for empty string', () => {
      expect(parseAttunementRequirements('')).toEqual([]);
    });
  });
});
