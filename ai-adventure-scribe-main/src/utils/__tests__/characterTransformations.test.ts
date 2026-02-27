/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  transformAbilityScoresForStorage,
  transformEquipmentForStorage,
  transformMulticlassingForStorage,
  transformMulticlassingFromStorage,
} from '../characterTransformations';

import type { AbilityScores, Character } from '@/types/character';


describe('characterTransformations', () => {
  describe('transformAbilityScoresForStorage', () => {
    it('should correctly transform ability scores and calculate base AC and HP', () => {
      const abilityScores: AbilityScores = {
        strength: { score: 14, modifier: 2, savingThrow: false },
        dexterity: { score: 16, modifier: 3, savingThrow: false },
        constitution: { score: 12, modifier: 1, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 8, modifier: -1, savingThrow: false },
        charisma: { score: 13, modifier: 1, savingThrow: false },
      };
      const characterId = 'test-char-id';

      const result = transformAbilityScoresForStorage(abilityScores, characterId);

      expect(result).toEqual({
        character_id: characterId,
        strength: 14,
        dexterity: 16,
        constitution: 12,
        intelligence: 10,
        wisdom: 8,
        charisma: 13,
        armor_class: 13, // 10 + 3 (DEX modifier)
        current_hit_points: 9, // 8 + 1 (CON modifier)
        max_hit_points: 9,
      });
    });

    it('should handle missing modifiers by defaulting to 0', () => {
      const abilityScores: any = {
        strength: { score: 10 },
        dexterity: { score: 10 },
        constitution: { score: 10 },
        intelligence: { score: 10 },
        wisdom: { score: 10 },
        charisma: { score: 10 },
      };
      const result = transformAbilityScoresForStorage(abilityScores, 'id');
      expect(result.armor_class).toBe(10);
      expect(result.max_hit_points).toBe(8);
    });
  });

  describe('transformEquipmentForStorage', () => {
    it('should return empty array for missing inventory', () => {
      const character: Partial<Character> = { inventory: [] };
      expect(transformEquipmentForStorage(character as Character, 'id')).toEqual([]);

      const noInventory: Partial<Character> = {};
      expect(transformEquipmentForStorage(noInventory as Character, 'id')).toEqual([]);
    });

    it('should transform equipment with all properties including magic items', () => {
      const character: Partial<Character> = {
        inventory: [
          {
            itemId: 'Longsword',
            quantity: 1,
            equipped: true,
            isMagic: true,
            magicBonus: 1,
            magicProperties: ['Versatile'],
            requiresAttunement: false,
            magicItemType: 'weapon',
            magicItemRarity: 'uncommon',
            magicEffects: { attackBonus: 1, damageBonus: 1 } as any
          }
        ]
      };
      const characterId = 'char-123';

      const result = transformEquipmentForStorage(character as Character, characterId);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        character_id: characterId,
        item_name: 'Longsword',
        item_type: 'equipment',
        quantity: 1,
        equipped: true,
        is_magic: true,
        magic_bonus: 1,
        magic_properties: JSON.stringify(['Versatile']),
        requires_attunement: false,
        is_attuned: false,
        attunement_requirements: null,
        magic_item_type: 'weapon',
        magic_item_rarity: 'uncommon',
        magic_effects: JSON.stringify({ attackBonus: 1, damageBonus: 1 }),
      });
    });

    it('should use default values for missing equipment properties', () => {
       const character: Partial<Character> = {
        inventory: [
          {
            itemId: 'Bread',
            quantity: 5,
            equipped: false
          }
        ]
      };
      const result = transformEquipmentForStorage(character as Character, 'id');
      expect(result[0].is_magic).toBe(false);
      expect(result[0].magic_bonus).toBe(0);
      expect(result[0].magic_item_rarity).toBe('common');
    });
  });

  describe('Multiclassing Transformations', () => {
    it('should transform multiclassing for storage', () => {
      const character: Partial<Character> = {
        classLevels: [
          { classId: 'fighter', className: 'Fighter', level: 2, hitDie: 10, features: [] },
          { classId: 'wizard', className: 'Wizard', level: 1, hitDie: 6, features: [] }
        ],
        totalLevel: 3
      };

      const result = transformMulticlassingForStorage(character as Character);

      expect(result.total_level).toBe(3);
      expect(JSON.parse(result.class_levels as string)).toHaveLength(2);
    });

    it('should fallback to level if totalLevel is missing', () => {
      const character: Partial<Character> = { level: 5 };
      const result = transformMulticlassingForStorage(character as Character);
      expect(result.total_level).toBe(5);
    });

    it('should transform multiclassing from storage', () => {
      const dbData = {
        class_levels: JSON.stringify([
          { classId: 'rogue', level: 3 }
        ]),
        total_level: 3
      };

      const result = transformMulticlassingFromStorage(dbData);

      expect(result.classLevels).toHaveLength(1);
      expect(result.classLevels[0].classId).toBe('rogue');
      expect(result.totalLevel).toBe(3);
    });

    it('should handle null multiclassing data from storage', () => {
      const result = transformMulticlassingFromStorage({ class_levels: null, total_level: 1 });
      expect(result.classLevels).toBeNull();
      expect(result.totalLevel).toBe(1);
    });
  });
});
