/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { rollStateManager } from '../rollStateManager';

import { DiceEngine } from '@/services/dice/DiceEngine';

// Mock DiceEngine
vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    createDamageRollRequest: vi.fn(),
    createAttackRollRequest: vi.fn(),
  },
}));

describe('RollStateManager', () => {
  beforeEach(() => {
    rollStateManager.clearAllState();
    vi.clearAllMocks();
  });

  describe('addPendingRoll', () => {
    it('should add a pending roll and return an ID', () => {
      const rollData = {
        type: 'attack' as const,
        actorId: 'player1',
        context: 'Longsword attack',
      };

      const id = rollStateManager.addPendingRoll(rollData);

      expect(id).toBeDefined();
      expect(id).toContain('roll_');

      const pendingRolls = rollStateManager.getPendingRolls();
      expect(pendingRolls).toHaveLength(1);
      expect(pendingRolls[0]).toMatchObject({
        ...rollData,
        id,
      });
      expect(pendingRolls[0].timestamp).toBeDefined();
    });
  });

  describe('recordAttackRoll', () => {
    it('should record a hit correctly when total >= targetAC', () => {
      const rollId = rollStateManager.addPendingRoll({
        type: 'attack',
        actorId: 'player1',
        context: 'Attack',
      });

      const result = rollStateManager.recordAttackRoll(rollId, 15, 10);

      expect(result).toEqual({
        hit: true,
        critical: false,
        needsDamageRoll: true,
      });

      expect(rollStateManager.isAwaitingDamage()).toBe(true);
      expect(rollStateManager.getAwaitingDamageRoll()?.id).toBe(rollId);
      expect(rollStateManager.getPendingRolls()).toHaveLength(0);
      expect(rollStateManager.getCompletedRolls()).toHaveLength(1);
    });

    it('should record a miss correctly when total < targetAC', () => {
      const rollId = rollStateManager.addPendingRoll({
        type: 'attack',
        actorId: 'player1',
        context: 'Attack',
      });

      const result = rollStateManager.recordAttackRoll(rollId, 8, 10);

      expect(result).toEqual({
        hit: false,
        critical: false,
        needsDamageRoll: false,
      });

      expect(rollStateManager.isAwaitingDamage()).toBe(false);
    });

    it('should record a critical hit correctly on natural 20', () => {
      const rollId = rollStateManager.addPendingRoll({
        type: 'attack',
        actorId: 'player1',
        context: 'Attack',
      });

      const result = rollStateManager.recordAttackRoll(rollId, 20, 25); // Nat 20 hits even if total < AC in 5e (usually)

      expect(result).toEqual({
        hit: true,
        critical: true,
        needsDamageRoll: true,
      });

      expect(rollStateManager.isAwaitingDamage()).toBe(true);
      expect(rollStateManager.isAwaitingCriticalDamage()).toBe(true);
    });

    it('should return default values for non-existent rolls', () => {
      const result = rollStateManager.recordAttackRoll('invalid-id', 20);
      expect(result).toEqual({ hit: false, critical: false, needsDamageRoll: false });
    });
  });

  describe('recordDamageRoll', () => {
    it('should record damage and clear awaiting state', () => {
      const rollId = rollStateManager.addPendingRoll({
        type: 'attack',
        actorId: 'player1',
        context: 'Attack',
      });

      rollStateManager.recordAttackRoll(rollId, 15, 10);
      expect(rollStateManager.isAwaitingDamage()).toBe(true);

      rollStateManager.recordDamageRoll(rollId, 10, '1d8+2');

      expect(rollStateManager.isAwaitingDamage()).toBe(false);
      expect(rollStateManager.getCompletedRolls()).toHaveLength(2); // Attack and Damage
      expect(rollStateManager.getCompletedRolls()[1].type).toBe('damage');
    });
  });

  describe('Suggestions', () => {
    it('should get attack roll suggestion using DiceEngine', () => {
      const mockSuggestion = { formula: '1d20+5', purpose: 'Attack' };
      (DiceEngine.createAttackRollRequest as any).mockReturnValue(mockSuggestion);

      const suggestion = rollStateManager.getAttackRollSuggestion('Longsword');

      expect(DiceEngine.createAttackRollRequest).toHaveBeenCalledWith('Longsword', undefined);
      expect(suggestion).toEqual(mockSuggestion);
    });

    it('should get damage roll suggestion using DiceEngine', () => {
      const actorId = 'player1';
      const weaponName = 'Longsword';
      const rollId = rollStateManager.addPendingRoll({
        type: 'attack',
        actorId,
        context: 'Attack',
        weaponName,
      });

      rollStateManager.recordAttackRoll(rollId, 20, 10); // Critical

      const mockSuggestion = { formula: '2d8+2', purpose: 'Critical Damage' };
      (DiceEngine.createDamageRollRequest as any).mockReturnValue(mockSuggestion);

      const suggestion = rollStateManager.getDamageRollSuggestion(rollId);

      expect(DiceEngine.createDamageRollRequest).toHaveBeenCalledWith(
        weaponName,
        true, // isCritical
        undefined, // character
        undefined // preferredAbility
      );
      expect(suggestion).toEqual(mockSuggestion);
    });

    it('should return default suggestion if weapon not found', () => {
        const rollId = rollStateManager.addPendingRoll({
          type: 'attack',
          actorId: 'player1',
          context: 'Attack',
        });
        rollStateManager.recordAttackRoll(rollId, 15, 10);

        const suggestion = rollStateManager.getDamageRollSuggestion(rollId);
        expect(suggestion).toEqual({ formula: '1d6+3', purpose: 'Damage roll' });
    });

    it('should return null for non-existent attack roll suggestion', () => {
      expect(rollStateManager.getDamageRollSuggestion('invalid')).toBeNull();
    });
  });

  describe('Cleanup', () => {
    it('should clear completed rolls', () => {
      const rollId = rollStateManager.addPendingRoll({ type: 'attack', actorId: 'p1', context: 'A' });
      rollStateManager.recordAttackRoll(rollId, 15, 10);

      expect(rollStateManager.getCompletedRolls()).toHaveLength(1);
      rollStateManager.clearCompletedRolls();
      expect(rollStateManager.getCompletedRolls()).toHaveLength(0);
    });

    it('should clear all state', () => {
      rollStateManager.addPendingRoll({ type: 'attack', actorId: 'p1', context: 'A' });
      const rollId = rollStateManager.addPendingRoll({ type: 'attack', actorId: 'p1', context: 'A' });
      rollStateManager.recordAttackRoll(rollId, 15, 10);

      rollStateManager.clearAllState();
      expect(rollStateManager.getPendingRolls()).toHaveLength(0);
      expect(rollStateManager.getCompletedRolls()).toHaveLength(0);
      expect(rollStateManager.isAwaitingDamage()).toBe(false);
    });
  });
});
