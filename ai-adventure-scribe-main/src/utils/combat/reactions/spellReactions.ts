/**
 * Spell-specific Reaction Opportunities for D&D 5e Combat
 *
 * Extracted from reactionTriggers.ts
 */

import { createReactionOpportunity } from './reactionUtils';

import type {
  ReactionOpportunity,
  CombatParticipant,
  CombatEncounter,
} from '@/types/combat';

/**
 * Check for shield spell opportunities when damage is taken
 */
export function checkShieldSpellOpportunities(
  target: CombatParticipant,
  _encounter: CombatEncounter,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  // Check if target can cast shield spell
  if (canCastShieldSpell(target) && !target.reactionTaken && target.currentHitPoints > 0) {
    opportunities.push(
      createReactionOpportunity(
        target.id,
        'damage_taken',
        `You are hit by an attack`,
        ['shield_spell'],
        target.id, // Self-triggered
      ),
    );
  }

  return opportunities;
}

/**
 * Check if a participant can cast shield spell
 */
export function canCastShieldSpell(participant: CombatParticipant): boolean {
  // Check if they have shield spell prepared and available spell slots
  if (!participant.spellSlots || !participant.preparedSpells) return false;

  // Check if shield spell is prepared
  const hasShieldSpell = participant.preparedSpells.includes('shield');
  if (!hasShieldSpell) return false;

  // Check for available spell slots (shield is a 1st level spell)
  for (let level = 1; level <= 9; level++) {
    if (participant.spellSlots[level]?.current > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Check for absorb elements opportunities when damage is taken
 */
export function checkAbsorbElementsOpportunities(
  target: CombatParticipant,
  _encounter: CombatEncounter,
  damageType: string,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  // Check if target can cast absorb elements
  if (
    canCastAbsorbElements(target, damageType) &&
    !target.reactionTaken &&
    target.currentHitPoints > 0
  ) {
    opportunities.push(
      createReactionOpportunity(
        target.id,
        'damage_taken',
        `You are hit by ${damageType} damage`,
        ['absorb_elements'],
        target.id, // Self-triggered
      ),
    );
  }

  return opportunities;
}

/**
 * Check if a participant can cast absorb elements
 */
export function canCastAbsorbElements(participant: CombatParticipant, _damageType: string): boolean {
  // Check if they have absorb elements spell prepared and available spell slots
  if (!participant.spellSlots || !participant.preparedSpells) return false;

  // Check if absorb elements spell is prepared
  const hasAbsorbElementsSpell = participant.preparedSpells.includes('absorb_elements');
  if (!hasAbsorbElementsSpell) return false;

  // Check for available spell slots (absorb elements is a 1st level spell)
  for (let level = 1; level <= 9; level++) {
    if (participant.spellSlots[level]?.current > 0) {
      return true;
    }
  }

  return false;
}

/**
 * Check for hellish rebuke opportunities when damage is taken from an enemy
 */
export function checkHellishRebukeOpportunities(
  target: CombatParticipant,
  attacker: CombatParticipant,
  _encounter: CombatEncounter,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  // Check if target can cast hellish rebuke (warlock with appropriate spell slots)
  if (canCastHellishRebuke(target) && !target.reactionTaken && target.currentHitPoints > 0) {
    opportunities.push(
      createReactionOpportunity(
        target.id,
        'damage_taken',
        `You are hit by ${attacker.name}'s attack`,
        ['hellish_rebuke'],
        attacker.id,
      ),
    );
  }

  return opportunities;
}

/**
 * Check if a participant can cast hellish rebuke
 */
export function canCastHellishRebuke(participant: CombatParticipant): boolean {
  // Check if they have hellish rebuke spell prepared and available spell slots
  if (!participant.spellSlots || !participant.preparedSpells) return false;

  // Check if hellish rebuke spell is prepared
  const hasHellishRebukeSpell = participant.preparedSpells.includes('hellish_rebuke');
  if (!hasHellishRebukeSpell) return false;

  // Check for available spell slots (hellish rebuke is a 1st level spell)
  for (let level = 1; level <= 9; level++) {
    if (participant.spellSlots[level]?.current > 0) {
      return true;
    }
  }

  return false;
}
