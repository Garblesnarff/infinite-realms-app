/**
 * Reaction System for D&D 5e Combat
 *
 * Handles processing and management of reaction-based mechanics.
 * Reaction triggers have been moved to reactionTriggers.ts
 */

import type {
  ReactionOpportunity,
  ActionType,
  CombatParticipant,
  CombatEncounter,
  CombatAction,
} from '@/types/combat';

/**
 * Process a reaction response
 */
export function processReactionResponse(
  opportunity: ReactionOpportunity,
  selectedReaction: ActionType,
  encounter: CombatEncounter,
): Partial<CombatAction> {
  const participant = encounter.participants.find((p) => p.id === opportunity.participantId);
  const trigger = encounter.participants.find((p) => p.id === opportunity.triggeredBy);

  if (!participant || !trigger) {
    throw new Error('Invalid reaction participants');
  }

  switch (selectedReaction) {
    case 'opportunity_attack':
      return {
        participantId: opportunity.participantId,
        targetParticipantId: opportunity.triggeredBy,
        actionType: 'opportunity_attack',
        description: `${participant.name} makes an opportunity attack against ${trigger.name}`,
        round: encounter.currentRound,
        turnOrder: 0, // Reactions happen outside normal turn order
      };

    case 'counterspell':
      return {
        participantId: opportunity.participantId,
        targetParticipantId: opportunity.triggeredBy,
        actionType: 'counterspell',
        description: `${participant.name} attempts to counterspell ${trigger.name}'s spell`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'deflect_missiles':
      return {
        participantId: opportunity.participantId,
        actionType: 'deflect_missiles',
        description: `${participant.name} deflects the incoming missile`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'uncanny_dodge':
      return {
        participantId: opportunity.participantId,
        actionType: 'uncanny_dodge',
        description: `${participant.name} uses uncanny dodge to halve the damage`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'shield_spell':
      return {
        participantId: opportunity.participantId,
        actionType: 'shield_spell',
        description: `${participant.name} casts shield to gain +5 AC`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'absorb_elements':
      return {
        participantId: opportunity.participantId,
        actionType: 'absorb_elements',
        description: `${participant.name} uses absorb elements to gain resistance to the damage type`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'hellish_rebuke':
      return {
        participantId: opportunity.participantId,
        targetParticipantId: opportunity.triggeredBy,
        actionType: 'hellish_rebuke',
        description: `${participant.name} casts hellish rebuke against ${trigger.name}`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'divine_smite':
      return {
        participantId: opportunity.participantId,
        targetParticipantId: opportunity.triggeredBy,
        actionType: 'divine_smite',
        description: `${participant.name} uses Divine Smite against ${trigger.name}`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    case 'use_object':
      // Handle protection fighting style reaction
      return {
        participantId: opportunity.participantId,
        targetParticipantId: opportunity.triggeredBy,
        actionType: 'use_object',
        description: `${participant.name} uses protection fighting style to grant +2 AC to ally`,
        round: encounter.currentRound,
        turnOrder: 0,
      };

    default:
      throw new Error(`Unsupported reaction type: ${selectedReaction}`);
  }
}

/**
 * Clear expired reaction opportunities
 */
export function clearExpiredReactions(
  opportunities: ReactionOpportunity[],
  currentParticipantId?: string,
): ReactionOpportunity[] {
  // Remove opportunities that expire at end of turn
  return opportunities.filter((opp) => {
    if (opp.expiresAtEndOfTurn && opp.participantId !== currentParticipantId) {
      return false;
    }
    return true;
  });
}

/**
 * Check if participant has any available reactions
 */
export function hasAvailableReactions(participant: CombatParticipant): boolean {
  return !participant.reactionTaken && participant.currentHitPoints > 0;
}
