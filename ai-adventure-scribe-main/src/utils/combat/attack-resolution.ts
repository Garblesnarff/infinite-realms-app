/**
 * Attack roll resolution (hit/miss, critical, advantage/disadvantage),
 * split out of attackUtils.ts.
 */

import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant } from '@/types/combat';
import type { AttackResolution } from '@/utils/combat/attack-types';

import { calculateProficiencyBonus } from '@/utils/character-calculations';
import { getAbilityModifier, getSpellcastingAbility } from '@/utils/combat/attack-damage';
import { rollAttack } from '@/utils/diceUtils';

/**
 * Resolve an attack: roll attack dice and check against target AC
 */
export function resolveAttack(
  weapon: Equipment | null,
  attacker: CombatParticipant,
  target: CombatParticipant,
  options: {
    advantage?: boolean;
    disadvantage?: boolean;
    spellAttack?: boolean;
    divineSmiteLevel?: number;
    sneakAttack?: boolean;
  } = {},
): AttackResolution {
  const level = attacker.level || 1;
  const profBonus = calculateProficiencyBonus(level);

  // Calculate attack bonus based on weapon properties
  let attackBonus = 0;

  if (options.spellAttack) {
    // Spell attack: prof + spellcasting ability
    const spellAbility = getSpellcastingAbility(attacker);
    attackBonus = profBonus + (spellAbility || 0);
  } else if (weapon) {
    // Physical weapon attack
    const strMod = getAbilityModifier(attacker, 'strength');
    const dexMod = getAbilityModifier(attacker, 'dexterity');

    // Use finesse logic: higher of STR or DEX
    if (weapon.weaponProperties?.finesse) {
      attackBonus = profBonus + Math.max(strMod, dexMod);
    }
    // Use STR for melee weapons
    else if (!weapon.range) {
      attackBonus = profBonus + strMod;
    }
    // Use DEX for ranged weapons
    else {
      attackBonus = profBonus + dexMod;
    }

    // Add weapon-specific attack bonus (for magic weapons)
    attackBonus += weapon.attackBonus || 0;
  }

  // Apply condition-based advantage/disadvantage
  let hasAdvantage = options.advantage || false;
  let hasDisadvantage = options.disadvantage || false;

  // Check attacker conditions for advantage/disadvantage
  attacker.conditions.forEach((condition) => {
    switch (condition.name) {
      case 'invisible':
        hasAdvantage = true; // Attacker has advantage
        break;
      case 'blinded':
        hasDisadvantage = true; // Attacker has disadvantage
        break;
      case 'poisoned':
        hasDisadvantage = true; // Attacker has disadvantage
        break;
    }
  });

  // Check target conditions for advantage/disadvantage
  target.conditions.forEach((condition) => {
    switch (condition.name) {
      case 'prone':
        // melee advantage, but only if weapon is melee
        if (!weapon?.range) hasAdvantage = true;
        break;
      case 'paralyzed':
        hasAdvantage = true; // Auto-hit on critical (already covered)
        break;
      case 'stunned':
        hasAdvantage = true; // Auto-hit on critical (already covered)
        break;
      case 'unconscious':
        hasAdvantage = true; // Auto-hit on critical (already covered)
        break;
      case 'blinded':
        hasAdvantage = true; // Attacker has advantage
        break;
    }
  });

  // Can't have both advantage and disadvantage
  if (hasAdvantage && hasDisadvantage) {
    hasAdvantage = hasDisadvantage = false;
  }

  // Roll attack
  const roll = rollAttack(attackBonus, {
    advantage: hasAdvantage,
    disadvantage: hasDisadvantage,
  });

  // Determine if attack hits
  const targetAC = target.armorClass;
  let hit = roll.total >= targetAC;

  // Critical hit/fail rules
  const criticalHit = roll.naturalRoll === 20;
  const criticalFail = roll.naturalRoll === 1;

  // Critical hits always hit, natural 1s always miss
  if (criticalHit) {
    hit = true;
  } else if (criticalFail) {
    hit = false;
  }

  return {
    hit,
    roll,
    acHit: targetAC,
    criticalHit,
    criticalFail,
    advantage: hasAdvantage,
    disadvantage: hasDisadvantage,
  };
}
