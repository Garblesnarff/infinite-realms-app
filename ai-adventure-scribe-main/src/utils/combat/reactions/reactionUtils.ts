/**
 * Core Reaction Utilities for D&D 5e Combat
 *
 * Extracted from reactionTriggers.ts
 */

import type {
  ReactionOpportunity,
  ReactionTrigger,
  ActionType,
  CombatParticipant,
} from '@/types/combat';

/**
 * Create a reaction opportunity
 */
export function createReactionOpportunity(
  participantId: string,
  trigger: ReactionTrigger,
  triggerDescription: string,
  availableReactions: ActionType[],
  triggeredBy?: string,
): ReactionOpportunity {
  return {
    id: `reaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    participantId,
    trigger,
    triggerDescription,
    availableReactions,
    triggeredBy,
    expiresAtEndOfTurn: true,
  };
}

/**
 * Check if a participant can make opportunity attacks
 */
export function canMakeOpportunityAttack(
  participant: CombatParticipant,
  target: CombatParticipant,
): boolean {
  // Can't make opportunity attacks if incapacitated
  const incapacitatingConditions = ['stunned', 'paralyzed', 'unconscious', 'petrified'];
  const isIncapacitated = participant.conditions.some((c) =>
    incapacitatingConditions.includes(c.name),
  );

  if (isIncapacitated) return false;

  // Target must be leaving reach, not teleporting or being moved involuntarily
  return true;
}

/**
 * Check if a participant can cast counterspell
 */
export function canCastCounterspell(participant: CombatParticipant): boolean {
  // Check if they have counterspell available and spell slots
  if (!participant.spellSlots) return false;

  // Need at least a 3rd level spell slot for counterspell
  for (let level = 3; level <= 9; level++) {
    if (participant.spellSlots[level]?.current > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a participant can use deflect missiles
 */
export function canDeflectMissiles(participant: CombatParticipant): boolean {
  return participant.classFeatures?.some((f) => f.name === 'deflect_missiles') || false;
}

/**
 * Check if a participant has uncanny dodge
 */
export function hasUncannyDodge(participant: CombatParticipant): boolean {
  return participant.classFeatures?.some((f) => f.name === 'uncanny_dodge') || false;
}

/**
 * Check if a participant has protection fighting style
 */
export function hasProtectionFightingStyle(participant: CombatParticipant): boolean {
  return participant.fightingStyles?.some((style) => style.name === 'protection') || false;
}

/**
 * Check if a participant has polearm master feat
 */
export function hasPolearmMaster(participant: CombatParticipant): boolean {
  return participant.classFeatures?.some((f) => f.name === 'polearm_master') || false;
}

/**
 * Simple range check (in a real implementation, you'd have proper positioning)
 */
export function isWithinReach(
  participant: CombatParticipant,
  target: CombatParticipant,
  position: string,
): boolean {
  // Simplified - assume all melee combatants are within reach unless specified otherwise
  return position !== 'far' && position !== 'distant';
}

/**
 * Check if within counterspell range (60 feet)
 */
export function isWithinCounterspellRange(
  caster: CombatParticipant,
  target: CombatParticipant,
): boolean {
  // Simplified - assume most combat happens within counterspell range
  return true;
}
