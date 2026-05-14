
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { combatAuditSystem } from '../../combat-audit';
import { CombatActionTracker } from '../CombatActionTracker';

import logger from '@/lib/logger';

vi.mock('../../combat-audit', () => ({
  combatAuditSystem: {
    recordAction: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('CombatActionTracker', () => {
  let tracker: CombatActionTracker;
  const combatId = 'combat123';
  const actorId = 'actor456';
  const actorName = 'Grog';

  beforeEach(() => {
    tracker = new CombatActionTracker();
    vi.clearAllMocks();
  });

  describe('recordAttackRequest', () => {
    it('should record an attack request and return an attackId', () => {
      const weaponName = 'Greataxe';
      const targetAC = 15;

      const attackId = tracker.recordAttackRequest(combatId, actorId, weaponName, targetAC);

      expect(attackId).toContain(combatId);
      expect(attackId).toContain(actorId);
      expect(tracker.hasPendingAttack(combatId)).toBe(true);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Attack request recorded'));
    });
  });

  describe('recordAttackResult', () => {
    it('should record a hit and set awaiting damage', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 10);

      const isHit = tracker.recordAttackResult(attackId, 15, 10, actorId, actorName);

      expect(isHit).toBe(true);
      expect(tracker.isAwaitingDamage(combatId)).toBe(true);
      expect(tracker.hasPendingAttack(combatId)).toBe(false);
      expect(combatAuditSystem.recordAction).toHaveBeenCalledWith(expect.objectContaining({
        combatId,
        actorId,
        actorName,
        actionType: 'attack_roll',
        data: expect.objectContaining({
          success: true,
          result: 15,
        }),
      }));
    });

    it('should record a miss and not set awaiting damage', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 15);

      const isHit = tracker.recordAttackResult(attackId, 10, 15, actorId, actorName);

      expect(isHit).toBe(false);
      expect(tracker.isAwaitingDamage(combatId)).toBe(false);
      expect(combatAuditSystem.recordAction).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          success: false,
        }),
      }));
    });

    it('should handle critical hits', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 15);

      tracker.recordAttackResult(attackId, 20, 15, actorId, actorName);

      expect(tracker.getAwaitingDamage(combatId)).toEqual({
        weaponName: 'Sword',
        isCritical: true,
      });
      expect(combatAuditSystem.recordAction).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          critical: true,
        }),
      }));
    });

    it('should return false if attackId is not found', () => {
      const result = tracker.recordAttackResult('invalid-id', 20);
      expect(result).toBe(false);
    });

    it('should return false if targetAC is missing and not provided in result', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword');
      const result = tracker.recordAttackResult(attackId, 15);
      expect(result).toBe(false);
    });

    it('should use provided targetAC over recorded one', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 20);
      const isHit = tracker.recordAttackResult(attackId, 15, 10); // Result provides lower AC
      expect(isHit).toBe(true);
    });
  });

  describe('recordDamageRoll', () => {
    it('should record damage and clear awaiting state', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Mace', 10);
      tracker.recordAttackResult(attackId, 15, 10, actorId, actorName);

      tracker.recordDamageRoll(attackId, 8, '1d6+2', actorId, actorName);

      expect(tracker.isAwaitingDamage(combatId)).toBe(false);
      expect(combatAuditSystem.recordAction).toHaveBeenCalledWith(expect.objectContaining({
        actionType: 'damage_roll',
        data: expect.objectContaining({
          result: 8,
          formula: '1d6+2',
        }),
      }));
    });

    it('should handle missing formula', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Mace', 10);
      tracker.recordAttackResult(attackId, 15, 10, actorId, actorName);

      tracker.recordDamageRoll(attackId, 5, undefined, actorId, actorName);

      expect(combatAuditSystem.recordAction).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          formula: 'dice+modifier',
        }),
      }));
    });

    it('should not record action if no damageInfo found', () => {
      tracker.recordDamageRoll('non-existent', 10, '1d10', actorId, actorName);
      expect(combatAuditSystem.recordAction).not.toHaveBeenCalled();
    });
  });

  describe('State checks', () => {
    it('isAwaitingDamage should work with and without combatId', () => {
      expect(tracker.isAwaitingDamage()).toBe(false);

      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 10);
      tracker.recordAttackResult(attackId, 15, 10);

      expect(tracker.isAwaitingDamage()).toBe(true);
      expect(tracker.isAwaitingDamage(combatId)).toBe(true);
      expect(tracker.isAwaitingDamage('otherCombat')).toBe(false);
    });

    it('hasPendingAttack should work with and without combatId', () => {
      expect(tracker.hasPendingAttack()).toBe(false);

      tracker.recordAttackRequest(combatId, actorId, 'Sword', 10);

      expect(tracker.hasPendingAttack()).toBe(true);
      expect(tracker.hasPendingAttack(combatId)).toBe(true);
      expect(tracker.hasPendingAttack('otherCombat')).toBe(false);
    });

    it('getAwaitingDamage should return first awaiting damage info', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 10);
      tracker.recordAttackResult(attackId, 15, 10);

      const info = tracker.getAwaitingDamage(combatId);
      expect(info).toEqual({ weaponName: 'Sword', isCritical: false });

      expect(tracker.getAwaitingDamage('otherCombat')).toBeNull();
    });

    it('getAwaitingDamage should work without combatId', () => {
      const attackId = tracker.recordAttackRequest(combatId, actorId, 'Sword', 10);
      tracker.recordAttackResult(attackId, 15, 10);

      const info = tracker.getAwaitingDamage();
      expect(info).toEqual({ weaponName: 'Sword', isCritical: false });
    });
  });

  describe('Cleanup', () => {
    it('clearActionState should only clear state for specific combat', () => {
      tracker.recordAttackRequest('combat1', 'a1', 'W1');
      tracker.recordAttackRequest('combat2', 'a2', 'W2');

      const a3 = tracker.recordAttackRequest('combat1', 'a1', 'W3');
      tracker.recordAttackResult(a3, 15, 10); // awaiting damage

      tracker.clearActionState('combat1');

      expect(tracker.hasPendingAttack('combat1')).toBe(false);
      expect(tracker.hasPendingAttack('combat2')).toBe(true);
      expect(tracker.isAwaitingDamage('combat1')).toBe(false);
    });

    it('clearAllState should clear everything', () => {
      tracker.recordAttackRequest('combat1', 'a1', 'W1');
      tracker.recordAttackRequest('combat2', 'a2', 'W2');

      tracker.clearAllState();

      expect(tracker.hasPendingAttack()).toBe(false);
      expect(tracker.isAwaitingDamage()).toBe(false);
    });
  });
});
