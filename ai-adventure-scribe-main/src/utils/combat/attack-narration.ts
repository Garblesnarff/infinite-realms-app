import type { FullAttackResult } from './attack-types';
import type { Equipment } from '@/data/equipmentOptions';
import type { CombatParticipant, CombatAction } from '@/types/combat';

/**
 * Generate attack description
 * Extracted from attackUtils.ts
 */
export function generateAttackDescription(
  attacker: CombatParticipant,
  target: CombatParticipant,
  weapon: Equipment | null,
  result: FullAttackResult,
): string {
  const weaponName = weapon?.name || 'unarmed strike';

  if (!result.resolution.hit && !result.resolution.criticalHit) {
    return `${attacker.name} misses ${target.name} with ${weaponName}.`;
  }

  if (result.resolution.criticalHit) {
    return `${attacker.name} scores a critical hit on ${target.name} with ${weaponName} for ${result.totalDamageDealt} damage!`;
  }

  return `${attacker.name} hits ${target.name} with ${weaponName} for ${result.totalDamageDealt} damage.`;
}

/**
 * Create combat action from attack result
 * Extracted from attackUtils.ts
 */
export function createCombatActionFromAttack(
  attacker: CombatParticipant,
  target: CombatParticipant,
  weapon: Equipment | null,
  result: FullAttackResult,
): CombatAction {
  const isSpellAttack = !!(
    weapon &&
    typeof weapon === 'object' &&
    'isSpell' in (weapon as Record<string, unknown>) &&
    (weapon as Record<string, unknown>).isSpell === true
  );
  const attackType = isSpellAttack ? 'cast_spell' : 'attack';

  return {
    id: crypto.randomUUID(),
    encounterId: '', // Will be set by caller
    participantId: attacker.id,
    targetParticipantId: target.id,
    round: 0, // Will be set by caller
    turnOrder: 0, // Will be set by caller
    actionType: attackType,
    description: generateAttackDescription(attacker, target, weapon, result),
    attackRoll: result.resolution.roll,
    damageRolls: result.damage?.rolls || [],
    hit: result.resolution.hit,
    damageDealt: result.totalDamageDealt || 0,
    damageType: result.damage?.damageType || 'piercing',
    timestamp: new Date(),
  };
}
