/**
 * Rest Mechanics Tests
 *
 * Tests the pure D&D 5E rest mechanics.
 */

import { describe, it, expect } from 'vitest';

import { RestMechanics } from '../rest-mechanics';

import type { CharacterHitDice } from '../../../../db/schema/index';

describe('RestMechanics', () => {
  describe('calculateConModifier', () => {
    it('should correctly calculate modifiers', () => {
      expect(RestMechanics.calculateConModifier(10)).toBe(0);
      expect(RestMechanics.calculateConModifier(11)).toBe(0);
      expect(RestMechanics.calculateConModifier(12)).toBe(1);
      expect(RestMechanics.calculateConModifier(13)).toBe(1);
      expect(RestMechanics.calculateConModifier(8)).toBe(-1);
      expect(RestMechanics.calculateConModifier(9)).toBe(-1);
      expect(RestMechanics.calculateConModifier(20)).toBe(5);
    });
  });

  describe('getHitDieType', () => {
    it('should return correct die types for classes', () => {
      expect(RestMechanics.getHitDieType('Barbarian')).toBe('d12');
      expect(RestMechanics.getHitDieType('Fighter')).toBe('d10');
      expect(RestMechanics.getHitDieType('Wizard')).toBe('d6');
      expect(RestMechanics.getHitDieType('Unknown')).toBe('d8');
    });
  });

  describe('calculateSpentHitDice', () => {
    const mockHitDice: CharacterHitDice[] = [
      {
        id: '1',
        characterId: 'char1',
        className: 'Fighter',
        dieType: 'd10',
        totalDice: 5,
        usedDice: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: '2',
        characterId: 'char1',
        className: 'Wizard',
        dieType: 'd6',
        totalDice: 2,
        usedDice: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ] as any;

    it('should prefer largest dice first', () => {
      const result = RestMechanics.calculateSpentHitDice(1, 0, mockHitDice, [5]);
      expect(result.hpRestored).toBe(5);
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].id).toBe('1'); // Fighter d10
      expect(result.updates[0].newUsedDice).toBe(1);
    });

    it('should apply CON modifier (min 1)', () => {
      const result = RestMechanics.calculateSpentHitDice(1, -5, mockHitDice, [2]);
      expect(result.hpRestored).toBe(1); // 2 - 5 = -3, min 1
    });

    it('should handle multiple dice across classes', () => {
      const result = RestMechanics.calculateSpentHitDice(6, 0, mockHitDice, [5, 5, 5, 5, 5, 3]);
      expect(result.hpRestored).toBe(28);
      expect(result.updates).toHaveLength(2);
      expect(result.updates.find(u => u.id === '1')?.newUsedDice).toBe(5);
      expect(result.updates.find(u => u.id === '2')?.newUsedDice).toBe(1);
    });
  });

  describe('calculateRestoredHitDice', () => {
    const mockHitDice: CharacterHitDice[] = [
      {
        id: '1',
        characterId: 'char1',
        className: 'Fighter',
        dieType: 'd10',
        totalDice: 6,
        usedDice: 6,
      },
      {
        id: '2',
        characterId: 'char1',
        className: 'Wizard',
        dieType: 'd6',
        totalDice: 4,
        usedDice: 4,
      },
    ] as any;

    it('should restore up to half total hit dice (min 1)', () => {
      // Total dice = 10, should restore 5
      const result = RestMechanics.calculateRestoredHitDice(mockHitDice);
      expect(result.restoredCount).toBe(5);
      expect(result.updates).toHaveLength(1);
      expect(result.updates[0].id).toBe('1'); // Preferred d10
      expect(result.updates[0].newUsedDice).toBe(1); // 6 - 5 = 1
    });

    it('should respect requested count', () => {
      const result = RestMechanics.calculateRestoredHitDice(mockHitDice, 2);
      expect(result.restoredCount).toBe(2);
      expect(result.updates[0].newUsedDice).toBe(4); // 6 - 2 = 4
    });

    it('should not restore more than used', () => {
      const mostlyFreshDice: CharacterHitDice[] = [
        {
          id: '1',
          totalDice: 10,
          usedDice: 2,
          dieType: 'd10',
        }
      ] as any;
      const result = RestMechanics.calculateRestoredHitDice(mostlyFreshDice);
      expect(result.restoredCount).toBe(2); // Only 2 used, so only 2 restored even though maxRestore is 5
      expect(result.updates[0].newUsedDice).toBe(0);
    });
  });

  describe('getRestorableResources', () => {
    it('should return correct resources for short rest', () => {
      const resources = RestMechanics.getRestorableResources('short');
      expect(resources).toHaveLength(1);
      expect(resources[0].resourceType).toBe('class_feature');
    });

    it('should return correct resources for long rest', () => {
      const resources = RestMechanics.getRestorableResources('long');
      expect(resources).toHaveLength(4);
      expect(resources.map(r => r.resourceType)).toContain('hp');
      expect(resources.map(r => r.resourceType)).toContain('spell_slot');
      expect(resources.map(r => r.resourceType)).toContain('hit_dice');
    });
  });
});
