import { describe, it, expect, beforeEach, vi } from 'vitest';

import { combatAuditSystem } from '../../combat-audit';
import { combatSequenceValidator } from '../CombatSequenceValidator';

import logger from '@/lib/logger';

describe('CombatSequenceValidator', () => {
  const combatId = 'test-combat';

  beforeEach(() => {
    combatSequenceValidator.clearAllState();
    vi.clearAllMocks();
  });

  describe('Combat Lifecycle', () => {
    it('should start combat correctly', () => {
      combatSequenceValidator.startCombat(combatId);
      expect(combatSequenceValidator.isCombatActive(combatId)).toBe(true);
    });

    it('should end combat correctly and generate audit report', () => {
      const spy = vi.spyOn(combatAuditSystem, 'endCombatAudit');
      combatSequenceValidator.startCombat(combatId);
      combatSequenceValidator.endCombat(combatId);

      expect(combatSequenceValidator.isCombatActive(combatId)).toBe(false);
      expect(spy).toHaveBeenCalledWith(combatId);
    });

    it('should log violations when ending combat', () => {
      combatSequenceValidator.startCombat(combatId);
      // Create a violation by recording an attack without initiative in the audit system
      combatAuditSystem.recordAction({
        combatId,
        actorId: 'p1',
        actorName: 'Player 1',
        actionType: 'attack_roll',
        phase: 'turn',
        data: { description: 'Attack without initiative' },
      });

      const warnSpy = vi.spyOn(logger, 'warn');
      const errorSpy = vi.spyOn(logger, 'error');

      combatSequenceValidator.endCombat(combatId);

      expect(warnSpy).toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalled(); // attack without initiative is critical
    });

    it('should clean up pending attacks and damage on end combat', () => {
      vi.useFakeTimers();
      combatSequenceValidator.startCombat(combatId);
      // Record two attacks, one stays pending, one goes to awaiting damage
      combatSequenceValidator.recordAttackRequest(combatId, 'p1', 'Sword 1');
      vi.advanceTimersByTime(10);
      const attackId = combatSequenceValidator.recordAttackRequest(combatId, 'p1', 'Sword 2');
      combatSequenceValidator.recordAttackResult(attackId, 20, 10, 'p1', 'P1'); // Awaiting damage

      expect(combatSequenceValidator.isAwaitingDamage(combatId)).toBe(true);

      combatSequenceValidator.endCombat(combatId);

      expect(combatSequenceValidator.isAwaitingDamage(combatId)).toBe(false);
      // We can't easily check private pendingAttacks but we've covered the code lines
      vi.useRealTimers();
    });
  });

  describe('Initiative and Turn Order', () => {
    it('should track initiative entries and sort them correctly', () => {
      combatSequenceValidator.addInitiativeEntry(combatId, 'p1', 'Player 1', 15, 2);
      combatSequenceValidator.addInitiativeEntry(combatId, 'p2', 'Player 2', 20, 3);
      combatSequenceValidator.addInitiativeEntry(combatId, 'p3', 'Player 3', 15, 4);

      const turnOrder = combatSequenceValidator.completeInitiativePhase(combatId);

      expect(turnOrder).not.toBeNull();
      expect(turnOrder?.entries[0].actorId).toBe('p2'); // 20 initiative
      expect(turnOrder?.entries[1].actorId).toBe('p3'); // 15 initiative, 4 dex mod
      expect(turnOrder?.entries[2].actorId).toBe('p1'); // 15 initiative, 2 dex mod
    });

    it('should handle turn advancement and rounds', () => {
      combatSequenceValidator.addInitiativeEntry(combatId, 'p1', 'Player 1', 10, 0);
      combatSequenceValidator.addInitiativeEntry(combatId, 'p2', 'Player 2', 20, 0);
      combatSequenceValidator.completeInitiativePhase(combatId);

      expect(combatSequenceValidator.getCurrentActor(combatId)?.actorId).toBe('p2');

      const next = combatSequenceValidator.nextTurn(combatId);
      expect(next?.actorId).toBe('p1');

      const nextRound = combatSequenceValidator.nextTurn(combatId);
      expect(nextRound?.actorId).toBe('p2');
      expect(combatSequenceValidator.getTurnOrder(combatId)?.round).toBe(2);
    });
  });

  describe('Attack and Damage Sequencing', () => {
    it('should track attack and awaiting damage state', () => {
      const attackId = combatSequenceValidator.recordAttackRequest(combatId, 'p1', 'Longsword', 15);
      expect(attackId).toContain(combatId);

      const isHit = combatSequenceValidator.recordAttackResult(attackId, 18, 15, 'p1', 'Player 1');
      expect(isHit).toBe(true);
      expect(combatSequenceValidator.isAwaitingDamage(combatId)).toBe(true);

      const damageInfo = combatSequenceValidator.getAwaitingDamage(combatId);
      expect(damageInfo?.weaponName).toBe('Longsword');

      combatSequenceValidator.recordDamageRoll(attackId, 10, '1d8+2', 'p1', 'Player 1');
      expect(combatSequenceValidator.isAwaitingDamage(combatId)).toBe(false);
    });

    it('should handle undefined combatId in awaiting damage checks', () => {
      const attackId = combatSequenceValidator.recordAttackRequest(combatId, 'p1', 'Sword');
      combatSequenceValidator.recordAttackResult(attackId, 15, 10);

      expect(combatSequenceValidator.isAwaitingDamage()).toBe(true);
      expect(combatSequenceValidator.getAwaitingDamage()).not.toBeNull();
    });

    it('isAwaitingDamage should return false if no attacks for combatId', () => {
      const otherAttackId = combatSequenceValidator.recordAttackRequest(
        'other-combat',
        'p1',
        'Sword',
      );
      combatSequenceValidator.recordAttackResult(otherAttackId, 15, 10);
      expect(combatSequenceValidator.isAwaitingDamage(combatId)).toBe(false);
    });

    it('getAwaitingDamage should return null if no attacks for combatId', () => {
      const otherAttackId = combatSequenceValidator.recordAttackRequest(
        'other-combat',
        'p1',
        'Sword',
      );
      combatSequenceValidator.recordAttackResult(otherAttackId, 15, 10);
      expect(combatSequenceValidator.getAwaitingDamage(combatId)).toBeNull();
    });
  });

  describe('DM Response Validation', () => {
    it('should detect missing attack roll when damage is requested', () => {
      const response = 'Roll 1d8 damage for your attack.';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.type === 'missing_attack_roll')).toBe(true);
    });

    it('should detect missing initiative when combat starts', () => {
      const response = 'Combat begins! The goblins rush at you.';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.type === 'missing_initiative')).toBe(true);
    });

    it('should detect action before initiative is complete', () => {
      combatSequenceValidator.startCombat(combatId);
      const response = 'Make an attack roll against AC 15.';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.isValid).toBe(false);
      expect(result.errors.some((e) => e.type === 'wrong_sequence')).toBe(true);
    });

    it('should detect missing AC in attack request', () => {
      const response = 'Make an attack roll with your bow.';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.errors.some((e) => e.type === 'missing_ac')).toBe(true);
    });

    it('should detect missing DC in skill check', () => {
      const response = 'Make an Athletics check.';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.errors.some((e) => e.type === 'missing_dc')).toBe(true);
    });

    it('should detect missing modifier in damage request', () => {
      const response = 'That hits! Roll 1d8 damage.';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.warnings.some((w) => w.type === 'missing_modifier')).toBe(true);
    });

    it('should handle undefined combatId in validateDMResponse', () => {
      const response = 'Roll 1d8 damage.';
      const result = combatSequenceValidator.validateDMResponse(response);
      expect(result.errors.some((e) => e.type === 'missing_attack_roll')).toBe(true);
    });

    it('should validate correctly when all info is present', () => {
      combatSequenceValidator.addInitiativeEntry(combatId, 'p1', 'P1', 10, 0);
      combatSequenceValidator.completeInitiativePhase(combatId);

      const response = 'Make an attack roll against AC 15 with your longsword (1d20+5).';
      const result = combatSequenceValidator.validateDMResponse(response, combatId);

      expect(result.errors.length).toBe(0);
    });
  });

  describe('validateCombatState', () => {
    it('should return invalid if combat is not active', () => {
      const result = combatSequenceValidator.validateCombatState(combatId, 'attack');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Combat not active');
    });

    it('should return invalid if initiative is not complete', () => {
      combatSequenceValidator.startCombat(combatId);
      const result = combatSequenceValidator.validateCombatState(combatId, 'attack');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Initiative phase not complete');
    });

    it('should return valid if initiative is complete', () => {
      combatSequenceValidator.startCombat(combatId);
      combatSequenceValidator.addInitiativeEntry(combatId, 'p1', 'P1', 10, 0);
      combatSequenceValidator.completeInitiativePhase(combatId);

      const result = combatSequenceValidator.validateCombatState(combatId, 'attack');
      expect(result.valid).toBe(true);
    });

    it('should return invalid if turnOrder is missing even if initiativeRolled is true', () => {
      combatSequenceValidator.startCombat(combatId);
      // Manually mess with state to hit edge case
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((combatSequenceValidator as any).turnManager as any).initiativeRolled.add(combatId);
      const result = combatSequenceValidator.validateCombatState(combatId, 'attack');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('Initiative phase not complete');
    });
  });

  describe('Helper methods', () => {
    it('isInitiativeComplete should work correctly', () => {
      combatSequenceValidator.addInitiativeEntry(combatId, 'p1', 'P1', 10, 0);
      expect(combatSequenceValidator.isInitiativeComplete(combatId, ['p1'])).toBe(true);
      expect(combatSequenceValidator.isInitiativeComplete(combatId, ['p1', 'p2'])).toBe(false);
    });

    it('getSuggestion should return suggestion for errors', () => {
      const suggestion = combatSequenceValidator.getSuggestion('Roll 1d8 damage');
      expect(suggestion).toContain('attack roll first');
    });

    it('getSuggestion should return null for valid response', () => {
      const suggestion = combatSequenceValidator.getSuggestion('Hello');
      expect(suggestion).toBeNull();
    });
  });
});
