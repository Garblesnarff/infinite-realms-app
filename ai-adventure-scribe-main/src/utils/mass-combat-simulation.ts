/**
 * Battlefield movement, round simulation, and battle-end detection for
 * mass combat, split out of massCombat.ts. Also owns calculateArmyDamage
 * and resolveArmyAttack, which have no consumers outside this module and
 * would otherwise create a circular import with massCombat.ts.
 */

import type {
  Army,
  ArmyAttack,
  ArmyUnit,
  Battlefield,
  CombatRound,
  ArmyStatus,
  CombatEvent,
} from '@/types/massCombat';

import { rollDice } from '@/utils/diceUtils';

/**
 * Calculate damage for an army attack
 */
export function calculateArmyDamage(attack: ArmyAttack, targetUnit: ArmyUnit): number {
  // Parse dice notation
  const diceParts = attack.damage.split('d');
  const diceCount = parseInt(diceParts[0]) || 0;
  const diceSides = parseInt(diceParts[1]) || 0;
  let modifier = 0;

  // Extract modifier if present
  if (diceParts[1].includes('+')) {
    const modParts = diceParts[1].split('+');
    modifier = parseInt(modParts[1]) || 0;
  } else if (diceParts[1].includes('-')) {
    const modParts = diceParts[1].split('-');
    modifier = -(parseInt(modParts[1]) || 0);
  }

  // Roll damage
  const damageRoll = rollDice(diceSides, diceCount, modifier);
  let damage = damageRoll.total;

  // Apply armor protection
  const armorProtection = Math.max(0, targetUnit.armorClass - 10);
  damage = Math.max(1, damage - armorProtection);

  return damage;
}

/**
 * Resolve an attack between two army units
 */
export function resolveArmyAttack(
  attacker: ArmyUnit,
  defender: ArmyUnit,
  attack: ArmyAttack,
): { damage: number; casualties: number; description: string } {
  // Roll to hit
  const toHitRoll = rollDice(20, 1, attack.attackBonus);
  const hits = toHitRoll.total >= defender.armorClass;

  if (!hits) {
    return {
      damage: 0,
      casualties: 0,
      description: `${attacker.name} attacks ${defender.name} but misses.`,
    };
  }

  // Calculate damage
  const damage = calculateArmyDamage(attack, defender);

  // Calculate casualties
  const casualties = Math.floor(damage / defender.hitPoints);

  return {
    damage,
    casualties,
    description: `${attacker.name} hits ${defender.name} for ${damage} damage, causing ${casualties} casualties.`,
  };
}

/**
 * Move an army on the battlefield
 */
export function moveArmy(army: Army, newX: number, newY: number, battlefield: Battlefield): Army {
  // Check if movement is within battlefield bounds
  const withinBounds =
    newX >= 0 &&
    newX <= battlefield.dimensions.width &&
    newY >= 0 &&
    newY <= battlefield.dimensions.height;

  if (!withinBounds) {
    return army; // No movement if outside bounds
  }

  // Update army position
  return {
    ...army,
    position: { x: newX, y: newY },
  };
}

/**
 * Simulate one round of mass combat
 */
export function simulateCombatRound(
  armies: Army[],
  battlefield: Battlefield,
  roundNumber: number,
): CombatRound {
  const events: CombatEvent[] = [];
  const armyStatus: ArmyStatus[] = [];

  // Process each army's turn
  for (const army of armies) {
    // Skip destroyed or routing armies
    if (army.status === 'destroyed' || army.status === 'routing') {
      armyStatus.push({
        armyId: army.id,
        morale: army.units.reduce((sum, unit) => sum + unit.morale, 0) / army.units.length,
        supplies: army.supplies || 0,
        position: army.position,
        status: army.status,
      });
      continue;
    }

    // Army takes actions
    const roundEvents: CombatEvent[] = [];

    // Each unit in the army can act
    for (const unit of army.units) {
      // Skip destroyed units
      if (unit.size <= 0) continue;

      // Find a target (simplified - in a real implementation, this would be more complex)
      const enemyArmies = armies.filter((a) => a.faction !== army.faction && a.status === 'active');
      if (enemyArmies.length === 0) continue;

      const targetArmy = enemyArmies[0]; // Simplified target selection
      const targetUnit = targetArmy.units.find((u) => u.size > 0); // First available unit

      if (!targetUnit) continue;

      // Attack with each attack option
      for (const attack of unit.attacks) {
        const result = resolveArmyAttack(unit, targetUnit, attack);

        roundEvents.push({
          id: `attack-${Date.now()}-${Math.random()}`,
          type: 'attack',
          description: result.description,
          affectedArmies: [army.id, targetArmy.id],
        });
      }
    }

    // Update army status
    armyStatus.push({
      armyId: army.id,
      morale: army.units.reduce((sum, unit) => sum + unit.morale, 0) / army.units.length,
      supplies: army.supplies || 0,
      position: army.position,
      status: army.status,
    });

    // Add events to main events array
    events.push(...roundEvents);
  }

  return {
    roundNumber,
    events,
    armyStatus,
  };
}

/**
 * Determine if the battle has ended
 */
export function isBattleEnded(armies: Army[]): { ended: boolean; victor: string | null } {
  // Group armies by faction
  const factions: Record<string, Army[]> = {};

  armies.forEach((army) => {
    if (!factions[army.faction]) {
      factions[army.faction] = [];
    }
    factions[army.faction].push(army);
  });

  // Count active armies per faction
  const activeFactions: string[] = [];

  Object.keys(factions).forEach((faction) => {
    const activeArmies = factions[faction].filter(
      (army) => army.status === 'active' && army.units.some((unit) => unit.size > 0),
    );

    if (activeArmies.length > 0) {
      activeFactions.push(faction);
    }
  });

  // Battle ends when only one faction remains or no factions remain
  if (activeFactions.length === 0) {
    return { ended: true, victor: null }; // Draw
  }

  if (activeFactions.length === 1) {
    return { ended: true, victor: activeFactions[0] }; // Victory
  }

  return { ended: false, victor: null }; // Battle continues
}
