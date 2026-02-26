/**
 * Reaction Triggers for D&D 5e Combat
 *
 * Handles detection of opportunity attacks, counterspell, and other reaction-based triggers.
 * Extracted from reactionSystem.ts
 */

import type {
  ReactionOpportunity,
  ReactionTrigger,
  ActionType,
  CombatParticipant,
  CombatEncounter,
  CombatAction,
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
 * Check for shield spell opportunities when damage is taken
 */
export function checkShieldSpellOpportunities(
  target: CombatParticipant,
  encounter: CombatEncounter,
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
function canCastShieldSpell(participant: CombatParticipant): boolean {
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
  encounter: CombatEncounter,
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
function canCastAbsorbElements(participant: CombatParticipant, damageType: string): boolean {
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
  encounter: CombatEncounter,
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
function canCastHellishRebuke(participant: CombatParticipant): boolean {
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
