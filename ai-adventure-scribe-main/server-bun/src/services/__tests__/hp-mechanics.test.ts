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
      const result = HPMechanics.calculateDamageResult(
        'p1',
        defaultStatus,
        defaultResistances,
        options,
      );

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

    describe('#2236 hostile 0-HP death rule', () => {
      const monsterStatus = { ...defaultStatus, currentHp: 6, maxHp: 6 };

      it('kills a non-player reduced to 0 HP (run 10: the Vitruvian Spider)', () => {
        const options: ApplyDamageOptions = { damageAmount: 6, targetIsPlayer: false };
        const result = HPMechanics.calculateDamageResult(
          'spider',
          monsterStatus,
          defaultResistances,
          options,
        );
        expect(result.newCurrentHp).toBe(0);
        expect(result.isDead).toBe(true);
        expect(result.isConscious).toBe(false);
      });

      it('keeps player death-save semantics untouched at 0 HP', () => {
        const playerStatus = { ...defaultStatus, currentHp: 6 };
        const options: ApplyDamageOptions = { damageAmount: 6, targetIsPlayer: true };
        const result = HPMechanics.calculateDamageResult(
          'p1',
          playerStatus,
          defaultResistances,
          options,
        );
        expect(result.newCurrentHp).toBe(0);
        expect(result.isDead).toBe(false);
        expect(result.isConscious).toBe(false);
      });

      it('does not kill when targetIsPlayer is unknown (out-of-combat vitals path)', () => {
        const options: ApplyDamageOptions = { damageAmount: 6 };
        const result = HPMechanics.calculateDamageResult(
          'spider',
          monsterStatus,
          defaultResistances,
          options,
        );
        expect(result.newCurrentHp).toBe(0);
        expect(result.isDead).toBe(false);
      });
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

describe('HPMechanics: dropping to 0 and the dying state (#2518, SRD 5.1)', () => {
  const standing: HPStatusInput = {
    currentHp: 5,
    maxHp: 7,
    tempHp: 0,
    isConscious: true,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  };
  const none = { damageImmunities: [], damageResistances: [], damageVulnerabilities: [] };
  const hit = (
    status: HPStatusInput,
    damageAmount: number,
    extra: Partial<ApplyDamageOptions> = {},
  ) => HPMechanics.calculateDamageResult('p1', status, none, { damageAmount, ...extra });

  it('a drop whose overflow is below the maximum is dying {0,0}: unconscious, not dead, no failures', () => {
    const result = hit(standing, 8); // 5 HP + 3 overflow, maximum 7
    expect(result).toMatchObject({
      newCurrentHp: 0,
      isConscious: false,
      isDead: false,
      massiveDamage: false,
      overflow: 3,
      deathSaveFailuresAdded: 0,
      newDeathSavesFailures: 0,
      newDeathSavesSuccesses: 0,
    });
  });

  it('a drop whose overflow EQUALS the maximum is instant death', () => {
    const result = hit(standing, 12); // 5 HP + 7 overflow, maximum 7
    expect(result).toMatchObject({
      newCurrentHp: 0,
      isDead: true,
      massiveDamage: true,
      overflow: 7,
      newDeathSavesFailures: 3,
    });
  });

  it('one under the maximum is not instant death', () => {
    expect(hit(standing, 11)).toMatchObject({ isDead: false, massiveDamage: false, overflow: 6 });
  });

  it('temporary hit points are spent before the overflow is counted', () => {
    // 4 temp absorbs 4 of 12; 8 reaches the 5 HP: overflow 3.
    expect(hit({ ...standing, tempHp: 4 }, 12)).toMatchObject({
      overflow: 3,
      isDead: false,
      newTempHp: 0,
    });
  });

  it('a drop starts the sequence over: stale tallies from an earlier fall are cleared', () => {
    const result = hit({ ...standing, deathSavesSuccesses: 2, deathSavesFailures: 2 }, 5);
    expect(result).toMatchObject({ newDeathSavesFailures: 0, newDeathSavesSuccesses: 0 });
  });

  it('a hit on a stable creature is dying again: successes start over, one failure', () => {
    const stable: HPStatusInput = {
      ...standing,
      currentHp: 0,
      isConscious: false,
      deathSavesSuccesses: 3,
    };
    expect(hit(stable, 2)).toMatchObject({
      deathSaveFailuresAdded: 1,
      newDeathSavesFailures: 1,
      newDeathSavesSuccesses: 0,
    });
  });

  it('a critical hit on a creature at 0 is two failures; a third kills', () => {
    const dying: HPStatusInput = {
      ...standing,
      currentHp: 0,
      isConscious: false,
      deathSavesFailures: 1,
    };
    expect(hit(dying, 2, { isCriticalHit: true })).toMatchObject({
      deathSaveFailuresAdded: 2,
      newDeathSavesFailures: 3,
      isDead: true,
    });
  });

  it('the dead are not healed', () => {
    const dead: HPStatusInput = {
      ...standing,
      currentHp: 0,
      isConscious: false,
      deathSavesFailures: 3,
    };
    expect(HPMechanics.calculateHealingResult('p1', dead, 6)).toMatchObject({
      healingApplied: 0,
      newCurrentHp: 0,
      wasRevived: false,
      isConscious: false,
    });
  });

  it('healing a dying creature wakes it on exactly that HP', () => {
    const dying: HPStatusInput = {
      ...standing,
      currentHp: 0,
      isConscious: false,
      deathSavesFailures: 2,
    };
    expect(HPMechanics.calculateHealingResult('p1', dying, 3)).toMatchObject({
      newCurrentHp: 3,
      wasRevived: true,
      isConscious: true,
    });
  });
  describe('a stable creature that takes no damage', () => {
    const stable: HPStatusInput = {
      currentHp: 0,
      maxHp: 10,
      tempHp: 0,
      isConscious: false,
      deathSavesSuccesses: 3,
      deathSavesFailures: 0,
    };
    const resistances = {
      damageImmunities: ['fire'] as DamageType[],
      damageResistances: [],
      damageVulnerabilities: [],
    };

    it('stays stable when the damage is fully negated', () => {
      const result = HPMechanics.calculateDamageResult('p1', stable, resistances, {
        damageAmount: 6,
        damageType: 'fire',
      });
      expect(result.hpLost).toBe(0);
      expect(result.newDeathSavesSuccesses).toBe(3);
    });

    it('is dying again once real damage lands', () => {
      const result = HPMechanics.calculateDamageResult(
        'p1',
        stable,
        { damageImmunities: [], damageResistances: [], damageVulnerabilities: [] },
        {
          damageAmount: 2,
        },
      );
      expect(result.newDeathSavesSuccesses).toBe(0);
    });
  });
});
