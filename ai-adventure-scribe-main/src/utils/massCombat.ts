/**
 * Mass Combat Utilities for D&D 5e
 *
 * Functions for handling mass combat calculations, army management, and battle resolution
 */

import type {
  Army,
  MassCombatResult,
  CasualtyReport,
  TacticalManeuver,
  ArmyCommander,
  ControlZone,
} from '@/types/massCombat';

import { rollDice } from '@/utils/diceUtils';

// Re-export battlefield movement/simulation functions for backward compatibility
export {
  calculateArmyDamage,
  resolveArmyAttack,
  moveArmy,
  simulateCombatRound,
  isBattleEnded,
} from '@/utils/mass-combat-simulation';

/**
 * Calculate the total strength of an army
 */
export function calculateArmyStrength(army: Army): number {
  return army.units.reduce((total, unit) => {
    return total + unit.size * unit.hitPoints;
  }, 0);
}

/**
 * Check army morale after taking casualties
 */
export function checkArmyMorale(
  army: Army,
  casualties: number,
): {
  breaks: boolean;
  moraleChange: number;
  description: string;
} {
  // Calculate morale check DC based on casualties
  const casualtyPercentage =
    (casualties / army.units.reduce((sum, unit) => sum + unit.size, 0)) * 100;
  const moraleDC = 10 + Math.floor(casualtyPercentage / 10);

  // Roll morale check
  const armyMorale = army.units.reduce((sum, unit) => sum + unit.morale, 0) / army.units.length;
  const moraleRoll = rollDice(20, 1, Math.floor(armyMorale / 2));

  const breaks = moraleRoll.total < moraleDC;
  const moraleChange = breaks ? -2 : 1;

  const description = breaks
    ? `${army.name}'s army breaks and begins to rout!`
    : `${army.name}'s army stands firm despite casualties.`;

  return { breaks, moraleChange, description };
}

/**
 * Calculate casualties for an army
 */
export function calculateCasualties(army: Army, initialArmy: Army): CasualtyReport {
  const initialCount = initialArmy.units.reduce((sum, unit) => sum + unit.size, 0);
  const currentCount = army.units.reduce((sum, unit) => sum + unit.size, 0);
  const losses = initialCount - currentCount;

  return {
    armyId: army.id,
    unitType: army.units[0]?.type || 'infantry', // Simplified
    initialCount,
    losses,
    survivors: currentCount,
  };
}

/**
 * Execute a tactical maneuver
 */
export function executeTacticalManeuver(
  maneuver: TacticalManeuver,
  commander: ArmyCommander,
  _army: Army,
): { success: boolean; effect: string; description: string } {
  // Check if commander has required level
  if (commander.level < maneuver.requiredCommanderLevel) {
    return {
      success: false,
      effect: '',
      description: `${commander.name} is not experienced enough to execute ${maneuver.name}.`,
    };
  }

  // Apply maneuver effect (simplified)
  let effectDescription = '';

  switch (maneuver.id) {
    case 'flank_1':
      effectDescription = 'Units gain advantage on next attack roll.';
      break;
    case 'charge_1':
      effectDescription = 'Cavalry units deal double damage on next attack.';
      break;
    case 'rally_1':
      effectDescription = 'Nearby friendly units regain 2 morale points.';
      break;
    default:
      effectDescription = 'Tactical maneuver executed successfully.';
  }

  return {
    success: true,
    effect: effectDescription,
    description: `${commander.name} executes ${maneuver.name}: ${effectDescription}`,
  };
}

/**
 * Resupply an army
 */
export function resupplyArmy(army: Army, supplies: number): Army {
  return {
    ...army,
    supplies: (army.supplies || 0) + supplies,
  };
}

/**
 * Calculate strategic points from controlling zones
 */
export function calculateStrategicPoints(army: Army, controlZones: ControlZone[]): number {
  const controlledZones = controlZones.filter((zone) => zone.controllingArmyId === army.id);
  return controlledZones.reduce((sum, zone) => sum + zone.strategicValue, 0);
}

/**
 * Create a default mass combat result
 */
export function createDefaultCombatResult(): MassCombatResult {
  return {
    victor: null,
    survivingArmies: [],
    casualtyReports: [],
    battleLog: [],
    strategicPoints: 0,
  };
}
