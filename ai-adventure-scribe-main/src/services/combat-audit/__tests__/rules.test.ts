/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateAction } from '../rules';
import type { CombatAction } from '../types';

describe('combat-audit rules', () => {
  const combatId = 'test-combat';

  const createMockAction = (overrides: Partial<CombatAction> = {}): CombatAction => ({
    id: 'a1',
    combatId,
    timestamp: Date.now(),
    actorId: 'p1',
    actorName: 'Player 1',
    actionType: 'attack_roll',
    phase: 'combat',
    data: {},
    ...overrides,
  });

  describe('Rule 1: Initiative must be rolled first', () => {
    it('should flag a violation if first action is not initiative', () => {
      const action = createMockAction({ actionType: 'attack_roll' });
      const violations = validateAction(action, []);

      // Should have missing_initiative AND missing_ac
      expect(violations.some(v => v.violationType === 'missing_initiative')).toBe(true);
      expect(violations.some(v => v.severity === 'critical')).toBe(true);
    });

    it('should not flag if initiative was already rolled', () => {
      const initAction = createMockAction({ actionType: 'initiative', id: 'init-1' });
      // Include targetAC to avoid missing_ac violation
      const attackAction = createMockAction({ actionType: 'attack_roll', data: { targetAC: 15 } });
      const violations = validateAction(attackAction, [initAction]);

      expect(violations.some(v => v.violationType === 'missing_initiative')).toBe(false);
    });

    it('should not flag if action is pre-combat', () => {
      const action = createMockAction({ actionType: 'setup', phase: 'pre-combat' });
      const violations = validateAction(action, []);
      expect(violations.some(v => v.violationType === 'missing_initiative')).toBe(false);
    });
  });

  describe('Rule 2: Damage rolls must follow successful attack', () => {
    it('should flag damage without attack', () => {
      const action = createMockAction({ actionType: 'damage_roll', actorId: 'p1' });
      const violations = validateAction(action, []);

      expect(violations.some(v => v.violationType === 'damage_without_attack')).toBe(true);
    });

    it('should flag damage after failed attack', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const miss = createMockAction({
        id: 'attack-1',
        actionType: 'attack_roll',
        actorId: 'p1',
        data: { success: false }
      });
      const damage = createMockAction({ actionType: 'damage_roll', actorId: 'p1' });

      const violations = validateAction(damage, [init, miss]);
      expect(violations.some(v => v.violationType === 'damage_without_attack')).toBe(true);
    });

    it('should not flag damage after successful attack', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const hit = createMockAction({
        id: 'attack-1',
        actionType: 'attack_roll',
        actorId: 'p1',
        data: { success: true }
      });
      const damage = createMockAction({ actionType: 'damage_roll', actorId: 'p1', data: { formula: '1d8+3' } });

      const violations = validateAction(damage, [init, hit]);
      expect(violations.some(v => v.violationType === 'damage_without_attack')).toBe(false);
    });
  });

  describe('Rule 3: Attack rolls must specify target AC', () => {
    it('should flag missing target AC', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const attack = createMockAction({ actionType: 'attack_roll', data: {} });

      const violations = validateAction(attack, [init]);
      expect(violations.some(v => v.violationType === 'missing_ac')).toBe(true);
    });
  });

  describe('Rule 4: Saving throws must specify DC', () => {
    it('should flag missing DC', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const save = createMockAction({ actionType: 'save', data: {} });

      const violations = validateAction(save, [init]);
      expect(violations.some(v => v.violationType === 'missing_dc')).toBe(true);
    });
  });

  describe('Rule 5 & 6: Dice Formula Validation', () => {
    it('should flag invalid formula', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const attack = createMockAction({
        actionType: 'attack_roll',
        data: { formula: 'invalid', targetAC: 15 }
      });

      const violations = validateAction(attack, [init]);
      expect(violations.some(v => v.violationType === 'invalid_formula')).toBe(true);
    });

    it('should flag missing modifiers for attack rolls', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const attack = createMockAction({
        actionType: 'attack_roll',
        data: { formula: '1d20', targetAC: 15 }
      });

      const violations = validateAction(attack, [init]);
      expect(violations.some(v => v.violationType === 'missing_modifiers')).toBe(true);
    });

    it('should accept valid complex formulas', () => {
      const init = createMockAction({ actionType: 'initiative', id: 'init-1' });
      const damage = createMockAction({
        actionType: 'damage_roll',
        data: { formula: '2d6+1d4+3' },
        actorId: 'p1'
      });
      const hit = createMockAction({
        id: 'attack-1',
        actionType: 'attack_roll',
        actorId: 'p1',
        data: { success: true }
      });

      const violations = validateAction(damage, [init, hit]);
      expect(violations.some(v => v.violationType === 'invalid_formula')).toBe(false);
      expect(violations.some(v => v.violationType === 'missing_modifiers')).toBe(false);
    });
  });
});
