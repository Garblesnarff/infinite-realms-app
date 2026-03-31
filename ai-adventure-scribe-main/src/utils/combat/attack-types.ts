import type { DiceRoll, DamageType } from '@/types/combat';

export interface AttackResolution {
  hit: boolean;
  roll: DiceRoll;
  acHit: number; // The AC that was targeted/achieved
  criticalHit: boolean;
  criticalFail: boolean;
  advantage: boolean;
  disadvantage: boolean;
}

export interface DamageCalculation {
  rolls: DiceRoll[];
  totalBeforeResistance: number;
  totalAfterResistance: number;
  damageType: DamageType;
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
}

export interface FullAttackResult {
  resolution: AttackResolution;
  damage: DamageCalculation | null; // null if attack missed
  targetReducedHp?: number; // HP after damage applied
  totalDamageDealt?: number;
}
