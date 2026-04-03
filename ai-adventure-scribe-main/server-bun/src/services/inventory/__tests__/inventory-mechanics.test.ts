import { describe, it, expect } from 'vitest';

import {
  SPEED_PENALTIES,
} from '../../../types/inventory';
import { InventoryMechanics } from '../inventory-mechanics';

describe('InventoryMechanics', () => {
  describe('calculateCarryingCapacity', () => {
    it('should calculate base carrying capacity', () => {
      expect(InventoryMechanics.calculateCarryingCapacity(10)).toBe(150);
      expect(InventoryMechanics.calculateCarryingCapacity(15)).toBe(225);
    });
  });

  describe('calculateEncumbrance', () => {
    it('should return normal status when weight is low', () => {
      const result = InventoryMechanics.calculateEncumbrance(10, 49);
      expect(result.encumbranceLevel).toBe('normal');
      expect(result.isEncumbered).toBe(false);
      expect(result.speedPenalty).toBe(SPEED_PENALTIES.NORMAL);
    });

    it('should return encumbered status when weight exceeds STR x 5', () => {
      const result = InventoryMechanics.calculateEncumbrance(10, 51);
      expect(result.encumbranceLevel).toBe('encumbered');
      expect(result.isEncumbered).toBe(true);
      expect(result.isHeavilyEncumbered).toBe(false);
      expect(result.speedPenalty).toBe(SPEED_PENALTIES.ENCUMBERED);
    });

    it('should return heavily encumbered status when weight exceeds STR x 10', () => {
      const result = InventoryMechanics.calculateEncumbrance(10, 101);
      expect(result.encumbranceLevel).toBe('heavily_encumbered');
      expect(result.isEncumbered).toBe(true);
      expect(result.isHeavilyEncumbered).toBe(true);
      expect(result.speedPenalty).toBe(SPEED_PENALTIES.HEAVILY_ENCUMBERED);
    });

    it('should round current weight to 2 decimal places', () => {
      const result = InventoryMechanics.calculateEncumbrance(10, 50.1234);
      expect(result.currentWeight).toBe(50.12);
    });

    it('should include strength score and carrying capacity in result', () => {
      const result = InventoryMechanics.calculateEncumbrance(10, 50);
      expect(result.strengthScore).toBe(10);
      expect(result.carryingCapacity).toBe(150);
    });
  });
});
