/**
 * Reaction Triggers for D&D 5e Combat
 *
 * Handles detection of opportunity attacks, counterspell, and other reaction-based triggers.
 * Extracted from reactionSystem.ts
 */


import {
  createReactionOpportunity,
  canMakeOpportunityAttack,
  canCastCounterspell,
  canDeflectMissiles,
  hasUncannyDodge,
  hasProtectionFightingStyle,
  hasPolearmMaster,
  isWithinReach,
  isWithinCounterspellRange,
} from './combat/reactions/reactionUtils';
import {
  checkShieldSpellOpportunities,
  canCastShieldSpell,
  checkAbsorbElementsOpportunities,
  canCastAbsorbElements,
  checkHellishRebukeOpportunities,
  canCastHellishRebuke,
} from './combat/reactions/spellReactions';

import type {
  ReactionOpportunity,
  CombatParticipant,
  CombatEncounter,
  CombatAction,
} from '@/types/combat';

// Re-export utilities from modular files to maintain backward compatibility
export {
  createReactionOpportunity,
  canMakeOpportunityAttack,
  canCastCounterspell,
  canDeflectMissiles,
  hasUncannyDodge,
  hasProtectionFightingStyle,
  hasPolearmMaster,
  isWithinReach,
  isWithinCounterspellRange,
} from './combat/reactions/reactionUtils';

export {
  checkShieldSpellOpportunities,
  canCastShieldSpell,
  checkAbsorbElementsOpportunities,
  canCastAbsorbElements,
  checkHellishRebukeOpportunities,
  canCastHellishRebuke,
} from './combat/reactions/spellReactions';

/**
 * Check for opportunity attack triggers when a creature moves
 */
export function checkOpportunityAttacks(
  movingParticipant: CombatParticipant,
  encounter: CombatEncounter,
  fromPosition: string,
  toPosition: string,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  // Simple position-based check (in a real implementation, you'd have a proper positioning system)
  const nearbyEnemies = encounter.participants.filter(
    (p) =>
      p.id !== movingParticipant.id &&
      p.participantType !== movingParticipant.participantType &&
      p.currentHitPoints > 0 &&
      !p.reactionTaken &&
      isWithinReach(p, movingParticipant, fromPosition),
  );

  for (const enemy of nearbyEnemies) {
    // Check if they can make opportunity attacks
    if (canMakeOpportunityAttack(enemy, movingParticipant)) {
      opportunities.push(
        createReactionOpportunity(
          enemy.id,
          'creature_leaves_reach',
          `${movingParticipant.name} is leaving your reach`,
          ['opportunity_attack'],
          movingParticipant.id,
        ),
      );
    }
  }

  return opportunities;
}

/**
 * Check for counterspell opportunities when a spell is cast
 */
export function checkCounterspellOpportunities(
  caster: CombatParticipant,
  encounter: CombatEncounter,
  spellLevel: number,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  // Find potential counterspellers within range
  const potentialCounterspellers = encounter.participants.filter(
    (p) =>
      p.id !== caster.id &&
      p.currentHitPoints > 0 &&
      !p.reactionTaken &&
      canCastCounterspell(p) &&
      isWithinCounterspellRange(p, caster),
  );

  for (const counterspeller of potentialCounterspellers) {
    opportunities.push(
      createReactionOpportunity(
        counterspeller.id,
        'spell_cast_in_range',
        `${caster.name} is casting a spell within your range`,
        ['counterspell'],
        caster.id,
      ),
    );
  }

  return opportunities;
}

/**
 * Check for deflect missiles opportunities when a ranged attack hits
 */
export function checkDeflectMissilesOpportunities(
  attacker: CombatParticipant,
  target: CombatParticipant,
  isRangedWeaponAttack: boolean,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  if (isRangedWeaponAttack && canDeflectMissiles(target) && !target.reactionTaken) {
    opportunities.push(
      createReactionOpportunity(
        target.id,
        'ranged_attack_hits',
        `You are hit by a ranged weapon attack`,
        ['deflect_missiles'],
        attacker.id,
      ),
    );
  }

  return opportunities;
}

/**
 * Check for uncanny dodge opportunities when damage is taken
 */
export function checkUncannyDodgeOpportunities(
  attacker: CombatParticipant,
  target: CombatParticipant,
  canSeeAttacker: boolean = true,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  if (canSeeAttacker && hasUncannyDodge(target) && !target.reactionTaken) {
    opportunities.push(
      createReactionOpportunity(
        target.id,
        'damage_taken',
        `You are hit by an attack you can see`,
        ['uncanny_dodge'],
        attacker.id,
      ),
    );
  }

  return opportunities;
}

/**
 * Check for all reaction triggers based on combat action
 */
export function checkReactionTriggers(
  action: Partial<CombatAction> & {
    movement?: { fromPosition?: string; toPosition?: string };
    isRangedWeaponAttack?: boolean;
  },
  encounter: CombatEncounter,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  switch (action.actionType) {
    case 'attack':
      // Check for opportunity attacks if creature moves
      if (action.movement && action.movement.fromPosition && action.movement.toPosition) {
        const movingParticipant = encounter.participants.find((p) => p.id === action.participantId);
        if (movingParticipant) {
          opportunities.push(
            ...checkOpportunityAttacks(
              movingParticipant,
              encounter,
              action.movement.fromPosition,
              action.movement.toPosition,
            ),
          );
        }
      }

      // Check for deflect missiles if ranged attack hits
      if (action.hit && action.isRangedWeaponAttack) {
        const attacker = encounter.participants.find((p) => p.id === action.participantId);
        const target = encounter.participants.find((p) => p.id === action.targetParticipantId);
        if (attacker && target) {
          opportunities.push(...checkDeflectMissilesOpportunities(attacker, target, true));
        }
      }

      // Additional check for protection fighting style reaction
      if (action.hit && action.targetParticipantId) {
        const attacker = encounter.participants.find((p) => p.id === action.participantId);
        const target = encounter.participants.find((p) => p.id === action.targetParticipantId);

        // Check for allies nearby who might use protection fighting style
        const allies = encounter.participants.filter(
          (p) =>
            p.id !== action.participantId &&
            p.id !== action.targetParticipantId &&
            p.participantType === target?.participantType &&
            hasProtectionFightingStyle(p) &&
            !p.reactionTaken &&
            p.currentHitPoints > 0,
        );

        for (const ally of allies) {
          opportunities.push(
            createReactionOpportunity(
              ally.id,
              'ally_attacked_nearby',
              `${attacker?.name} is attacking your ally ${target?.name}`,
              ['use_object'], // Using 'use_object' as placeholder for protection reaction
              action.participantId,
            ),
          );
        }
      }
      break;

    case 'cast_spell': {
      // Check for counterspell opportunities
      const caster = encounter.participants.find((p) => p.id === action.participantId);
      if (caster) {
        opportunities.push(
          ...checkCounterspellOpportunities(caster, encounter, action.spellLevel || 1),
        );
      }
      break;
    }

    case 'damage_dealt': {
      // Check for uncanny dodge when damage is taken
      const attacker = encounter.participants.find((p) => p.id === action.participantId);
      const target = encounter.participants.find((p) => p.id === action.targetParticipantId);
      if (attacker && target) {
        opportunities.push(...checkUncannyDodgeOpportunities(attacker, target));

        // Check for shield spell reaction
        const shieldSpellOpportunities = checkShieldSpellOpportunities(target, encounter);
        opportunities.push(...shieldSpellOpportunities);

        // Check for absorb elements reaction (if damage type is applicable)
        if (action.damageType) {
          const absorbElementsOpportunities = checkAbsorbElementsOpportunities(
            target,
            encounter,
            action.damageType,
          );
          opportunities.push(...absorbElementsOpportunities);
        }

        // Check for hellish rebuke reaction (if attacker is an enemy)
        if (attacker.participantType !== target.participantType) {
          const hellishRebukeOpportunities = checkHellishRebukeOpportunities(
            target,
            attacker,
            encounter,
          );
          opportunities.push(...hellishRebukeOpportunities);
        }
      }
      break;
    }

    case 'move': {
      // Check for polearm master reaction when creature enters reach
      if (action.fromPosition && action.toPosition) {
        const movingParticipant = encounter.participants.find((p) => p.id === action.participantId);
        if (movingParticipant) {
          // Check for creatures with polearm master feat who might react
          const polearmMasters = encounter.participants.filter(
            (p) =>
              p.id !== action.participantId &&
              hasPolearmMaster(p) &&
              !p.reactionTaken &&
              p.currentHitPoints > 0,
          );

          for (const master of polearmMasters) {
            // Simple check - in a real implementation, you'd have proper positioning
            if (action.toPosition === 'melee' || action.toPosition === 'adjacent') {
              opportunities.push(
                createReactionOpportunity(
                  master.id,
                  'creature_enters_reach',
                  `${movingParticipant.name} is entering your reach`,
                  ['opportunity_attack'],
                  action.participantId,
                ),
              );
            }
          }
        }
      }
      break;
    }
  }

  return opportunities;
}

/**
 * Check for opportunity attacks when a participant moves
 */
export function checkMovementOpportunityAttacks(
  movingParticipant: CombatParticipant,
  encounter: CombatEncounter,
  fromPosition: string,
  toPosition: string,
): ReactionOpportunity[] {
  const opportunities: ReactionOpportunity[] = [];

  // Simple position-based check (in a real implementation, you'd have a proper positioning system)
  const nearbyEnemies = encounter.participants.filter(
    (p) =>
      p.id !== movingParticipant.id &&
      p.participantType !== movingParticipant.participantType &&
      p.currentHitPoints > 0 &&
      !p.reactionTaken &&
      isWithinReach(p, movingParticipant, fromPosition),
  );

  for (const enemy of nearbyEnemies) {
    // Check if they can make opportunity attacks
    if (canMakeOpportunityAttack(enemy, movingParticipant)) {
      opportunities.push(
        createReactionOpportunity(
          enemy.id,
          'creature_leaves_reach',
          `${movingParticipant.name} is leaving your reach`,
          ['opportunity_attack'],
          movingParticipant.id,
        ),
      );
    }
  }

  return opportunities;
}
