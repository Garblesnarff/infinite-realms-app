import { describe, it, expect } from 'vitest';

import { HPMechanics, type HPStatusInput } from '../combat/hp-mechanics.js';

import type { ApplyDamageOptions, DamageType } from '../../types/combat.js';

describe('HPMechanics', () => {
  const defaultStatus: HPStatusInput = {
    currentHp: 50,
    maxHp: 50,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  };

  const defaultResistances = {
    damageImmunities: [],
    damageResistances: [],
    damageVulnerabilities: [],
  };

  describe('calculateDamageResult', () => {
    it('should apply normal damage correctly', () => {
      const options: ApplyDamageOptions = { damageAmount: 10 };
      const result = HPMechanics.calculateDamageResult('p1', defaultStatus, defaultResistances, options);

      expect(result.hpLost).toBe(10);
      expect(result.newCurrentHp).toBe(40);
      expect(result.isConscious).toBe(true);
      expect(result.isDead).toBe(false);
    });

    it('should use temp HP before real HP', () => {
      const status = { ...defaultStatus, tempHp: 5 };
      const options: ApplyDamageOptions = { damageAmount: 10 };
      const result = HPMechanics.calculateDamageResult('p1', status, defaultResistances, options);

      expect(result.tempHpLost).toBe(5);
      expect(result.hpLost).toBe(5);
      expect(result.newCurrentHp).toBe(45);
      expect(result.newTempHp).toBe(0);
    });

    it('should apply resistance (half damage, round down)', () => {
      const resistances = { ...defaultResistances, damageResistances: ['fire'] };
      const options: ApplyDamageOptions = { damageAmount: 11, damageType: 'fire' as DamageType };
      const result = HPMechanics.calculateDamageResult('p1', defaultStatus, resistances, options);

      expect(result.modifiedDamage).toBe(5);
      expect(result.hpLost).toBe(5);
      expect(result.wasResisted).toBe(true);
    });

    it('should apply vulnerability (double damage)', () => {
      const resistances = { ...defaultResistances, damageVulnerabilities: ['fire'] };
      const options: ApplyDamageOptions = { damageAmount: 10, damageType: 'fire' as DamageType };
      const result = HPMechanics.calculateDamageResult('p1', defaultStatus, resistances, options);

      expect(result.modifiedDamage).toBe(20);
      expect(result.hpLost).toBe(20);
      expect(result.wasVulnerable).toBe(true);
    });

    it('should apply immunity (zero damage)', () => {
      const resistances = { ...defaultResistances, damageImmunities: ['fire'] };
      const options: ApplyDamageOptions = { damageAmount: 10, damageType: 'fire' as DamageType };
      const result = HPMechanics.calculateDamageResult('p1', defaultStatus, resistances, options);

      expect(result.modifiedDamage).toBe(0);
      expect(result.hpLost).toBe(0);
      expect(result.wasImmune).toBe(true);
    });

    it('should handle massive damage instant death', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false };
      const options: ApplyDamageOptions = { damageAmount: 50 }; // Equal to max HP
      const result = HPMechanics.calculateDamageResult('p1', status, defaultResistances, options);

      expect(result.massiveDamage).toBe(true);
      expect(result.isDead).toBe(true);
      expect(result.newDeathSavesFailures).toBe(3);
    });

    it('should add death save failure when taking damage at 0 HP', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesFailures: 0 };
      const options: ApplyDamageOptions = { damageAmount: 5 };
      const result = HPMechanics.calculateDamageResult('p1', status, defaultResistances, options);

      expect(result.deathSaveFailuresAdded).toBe(1);
      expect(result.newDeathSavesFailures).toBe(1);
    });

    it('should add 2 death save failures on critical hit at 0 HP', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesFailures: 0 };
      const options: ApplyDamageOptions = { damageAmount: 5, isCriticalHit: true };
      const result = HPMechanics.calculateDamageResult('p1', status, defaultResistances, options);

      expect(result.deathSaveFailuresAdded).toBe(2);
      expect(result.newDeathSavesFailures).toBe(2);
    });
  });

  describe('calculateHealingResult', () => {
    it('should heal correctly up to max HP', () => {
      const status = { ...defaultStatus, currentHp: 40 };
      const result = HPMechanics.calculateHealingResult('p1', status, 20);

      expect(result.healingApplied).toBe(10);
      expect(result.newCurrentHp).toBe(50);
      expect(result.overheal).toBe(10);
    });

    it('should revive unconscious characters', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false };
      const result = HPMechanics.calculateHealingResult('p1', status, 1);

      expect(result.wasRevived).toBe(true);
      expect(result.isConscious).toBe(true);
    });
  });

  describe('resolveDeathSave', () => {
    it('should revive with 1 HP on natural 20', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesFailures: 2 };
      const result = HPMechanics.resolveDeathSave('p1', status, 20);

      expect(result.wasRevived).toBe(true);
      expect(result.newCurrentHp).toBe(1);
      expect(result.successes).toBe(0);
      expect(result.failures).toBe(0);
    });

    it('should add 2 failures on natural 1', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesFailures: 0 };
      const result = HPMechanics.resolveDeathSave('p1', status, 1);

      expect(result.failures).toBe(2);
      expect(result.isCritical).toBe(true);
      expect(result.isSuccess).toBe(false);
    });

    it('should add 1 failure on 2-9', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesFailures: 0 };
      const result = HPMechanics.resolveDeathSave('p1', status, 5);

      expect(result.failures).toBe(1);
      expect(result.isSuccess).toBe(false);
    });

    it('should add 1 success on 10-19', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesSuccesses: 0 };
      const result = HPMechanics.resolveDeathSave('p1', status, 15);

      expect(result.successes).toBe(1);
      expect(result.isSuccess).toBe(true);
    });

    it('should stabilize on 3 successes', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesSuccesses: 2 };
      const result = HPMechanics.resolveDeathSave('p1', status, 15);

      expect(result.isStabilized).toBe(true);
    });

    it('should die on 3 failures', () => {
      const status = { ...defaultStatus, currentHp: 0, isConscious: false, deathSavesFailures: 2 };
      const result = HPMechanics.resolveDeathSave('p1', status, 5);

      expect(result.isDead).toBe(true);
    });
  });

  describe('resolveStabilization', () => {
    it('should succeed on roll >= 10', () => {
      const result = HPMechanics.resolveStabilization('p1', 8, 2);
      expect(result.success).toBe(true);
      expect(result.isStabilized).toBe(true);
    });

    it('should fail on roll < 10', () => {
      const result = HPMechanics.resolveStabilization('p1', 5, 2);
      expect(result.success).toBe(false);
      expect(result.isStabilized).toBe(false);
    });
  });
});
