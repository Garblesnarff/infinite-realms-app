/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { generateAttackDescription, createCombatActionFromAttack } from '../attack-narration';

import type { FullAttackResult } from '../attack-types';
import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant } from '@/types/combat';


describe('attack-narration', () => {
  const mockAttacker: Partial<CombatParticipant> = {
    id: 'attacker-1',
    name: 'Grog',
    participantType: 'player',
  };

  const mockTarget: Partial<CombatParticipant> = {
    id: 'target-1',
    name: 'Goblin',
    participantType: 'enemy',
  };

  const mockWeapon: Partial<Equipment> = {
    name: 'Greatsword',
  };

  describe('generateAttackDescription', () => {
    it('should return a miss description when the attack misses', () => {
      const result: FullAttackResult = {
        resolution: {
          hit: false,
          criticalHit: false,
          roll: {} as any,
          acHit: 10,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: null,
      };

      const description = generateAttackDescription(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        mockWeapon as Equipment,
        result,
      );

      expect(description).toBe('Grog misses Goblin with Greatsword.');
    });

    it('should return a hit description when the attack hits', () => {
      const result: FullAttackResult = {
        resolution: {
          hit: true,
          criticalHit: false,
          roll: {} as any,
          acHit: 15,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: {
          rolls: [],
          totalBeforeResistance: 10,
          totalAfterResistance: 10,
          damageType: 'slashing',
          resistances: [],
          vulnerabilities: [],
          immunities: [],
        },
        totalDamageDealt: 10,
      };

      const description = generateAttackDescription(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        mockWeapon as Equipment,
        result,
      );

      expect(description).toBe('Grog hits Goblin with Greatsword for 10 damage.');
    });

    it('should return a critical hit description', () => {
      const result: FullAttackResult = {
        resolution: {
          hit: true,
          criticalHit: true,
          roll: {} as any,
          acHit: 25,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: {
          rolls: [],
          totalBeforeResistance: 20,
          totalAfterResistance: 20,
          damageType: 'slashing',
          resistances: [],
          vulnerabilities: [],
          immunities: [],
        },
        totalDamageDealt: 20,
      };

      const description = generateAttackDescription(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        mockWeapon as Equipment,
        result,
      );

      expect(description).toBe('Grog scores a critical hit on Goblin with Greatsword for 20 damage!');
    });

    it('should handle unarmed strikes (null weapon)', () => {
      const result: FullAttackResult = {
        resolution: {
          hit: true,
          criticalHit: false,
          roll: {} as any,
          acHit: 15,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: {
          rolls: [],
          totalBeforeResistance: 5,
          totalAfterResistance: 5,
          damageType: 'bludgeoning',
          resistances: [],
          vulnerabilities: [],
          immunities: [],
        },
        totalDamageDealt: 5,
      };

      const description = generateAttackDescription(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        null,
        result,
      );

      expect(description).toBe('Grog hits Goblin with unarmed strike for 5 damage.');
    });
  });

  describe('createCombatActionFromAttack', () => {
    it('should create a valid combat action for a weapon attack', () => {
      const result: FullAttackResult = {
        resolution: {
          hit: true,
          criticalHit: false,
          roll: { total: 18 } as any,
          acHit: 18,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: {
          rolls: [{ total: 8 }] as any,
          totalBeforeResistance: 8,
          totalAfterResistance: 8,
          damageType: 'slashing',
          resistances: [],
          vulnerabilities: [],
          immunities: [],
        },
        totalDamageDealt: 8,
      };

      const action = createCombatActionFromAttack(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        mockWeapon as Equipment,
        result,
      );

      expect(action.id).toBeDefined();
      expect(action.participantId).toBe(mockAttacker.id);
      expect(action.targetParticipantId).toBe(mockTarget.id);
      expect(action.actionType).toBe('attack');
      expect(action.hit).toBe(true);
      expect(action.damageDealt).toBe(8);
      expect(action.damageType).toBe('slashing');
      expect(action.attackRoll?.total).toBe(18);
      expect(action.description).toContain('Grog hits Goblin with Greatsword');
    });

    it('should create a valid combat action for a spell attack', () => {
      const spellWeapon = {
        name: 'Fire Bolt',
        isSpell: true,
      } as any;

      const result: FullAttackResult = {
        resolution: {
          hit: true,
          criticalHit: false,
          roll: { total: 20 } as any,
          acHit: 20,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: {
          rolls: [{ total: 12 }] as any,
          totalBeforeResistance: 12,
          totalAfterResistance: 12,
          damageType: 'fire',
          resistances: [],
          vulnerabilities: [],
          immunities: [],
        },
        totalDamageDealt: 12,
      };

      const action = createCombatActionFromAttack(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        spellWeapon as Equipment,
        result,
      );

      expect(action.actionType).toBe('cast_spell');
      expect(action.damageType).toBe('fire');
      expect(action.description).toContain('Fire Bolt');
    });

    it('should use default values for missing damage result', () => {
      const result: FullAttackResult = {
        resolution: {
          hit: false,
          criticalHit: false,
          roll: {} as any,
          acHit: 10,
          criticalFail: false,
          advantage: false,
          disadvantage: false,
        },
        damage: null,
      };

      const action = createCombatActionFromAttack(
        mockAttacker as CombatParticipant,
        mockTarget as CombatParticipant,
        mockWeapon as Equipment,
        result,
      );

      expect(action.hit).toBe(false);
      expect(action.damageDealt).toBe(0);
      expect(action.damageType).toBe('piercing'); // Default from implementation
      expect(action.damageRolls).toEqual([]);
    });
  });
});
