/**
 * Core D&D 5e combat mechanics vocabulary: phases, actions, damage,
 * conditions, cover, vision, fighting styles, and weapon properties.
 */

// ===========================
// Core Combat Types
// ===========================

export type CombatPhase =
  | 'initialization' // Rolling initiative, starting combat
  | 'active' // Taking turns in initiative order
  | 'conclusion'; // Combat ending, cleanup

export type ParticipantType =
  | 'player' // Player character
  | 'npc' // Friendly NPC
  | 'monster'; // Enemy creature

export type ActionType =
  | 'attack' // Weapon or spell attack
  | 'off_hand_attack' // Two-weapon fighting bonus action attack
  | 'cast_spell' // Casting a spell
  | 'dash' // Move extra distance
  | 'dodge' // Gain AC bonus
  | 'help' // Help another character
  | 'hide' // Attempt stealth
  | 'ready' // Ready an action
  | 'search' // Look for something
  | 'use_object' // Interact with item
  | 'grapple' // Special melee attack to grapple
  | 'shove' // Special melee attack to push/prone
  | 'death_save' // Roll death saving throw
  | 'concentration_save' // Roll to maintain concentration
  | 'bonus_action' // Secondary action
  | 'reaction' // Response to trigger
  | 'opportunity_attack' // Specific reaction type
  | 'counterspell' // Specific reaction type
  | 'deflect_missiles' // Specific reaction type
  | 'shield_spell' // Shield reaction
  | 'absorb_elements' // Absorb elements reaction
  | 'hellish_rebuke' // Hellish rebuke reaction
  | 'divine_smite' // Paladin's Divine Smite
  | 'use_class_feature' // Use a class feature (rage, second wind, etc.)
  | 'end_rage' // End rage
  | 'short_rest' // Take a short rest
  | 'long_rest'; // Take a long rest

export type ReactionTrigger =
  | 'creature_leaves_reach' // Opportunity attack
  | 'spell_cast_in_range' // Counterspell
  | 'ranged_attack_hits' // Deflect missiles
  | 'creature_enters_reach' // Polearm master
  | 'damage_taken' // Uncanny dodge, shield
  | 'ally_attacked_nearby'; // Protection fighting style

export interface ReactionOpportunity {
  id: string;
  participantId: string; // Who can react
  trigger: ReactionTrigger;
  triggerDescription: string;
  availableReactions: ActionType[];
  triggeredBy?: string; // Participant ID who triggered it
  expiresAtEndOfTurn?: boolean;
}

export type DamageType =
  | 'acid'
  | 'bludgeoning'
  | 'cold'
  | 'fire'
  | 'force'
  | 'lightning'
  | 'necrotic'
  | 'piercing'
  | 'poison'
  | 'psychic'
  | 'radiant'
  | 'slashing'
  | 'thunder';

// ===========================
// D&D Conditions
// ===========================

export type ConditionName =
  | 'blinded'
  | 'charmed'
  | 'deafened'
  | 'frightened'
  | 'grappled'
  | 'incapacitated'
  | 'invisible'
  | 'paralyzed'
  | 'petrified'
  | 'poisoned'
  | 'prone'
  | 'restrained'
  | 'stunned'
  | 'unconscious'
  | 'exhaustion'
  | 'surprised';

export interface Condition {
  name: ConditionName;
  description: string;
  duration: number; // rounds, -1 for permanent
  saveEndsType?: 'start' | 'end'; // when save is made
  saveDC?: number;
  saveAbility?: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';
  sourceSpell?: string;
  concentrationRequired?: boolean;
  level?: number; // For exhaustion levels (1-6)
}

export interface ExhaustionEffect {
  level: number;
  description: string;
  effect: {
    disadvantageOnAbilityChecks?: boolean;
    speedHalved?: boolean;
    disadvantageOnAttacksAndSaves?: boolean;
    hitPointMaxHalved?: boolean;
    speedReducedToZero?: boolean;
    death?: boolean;
  };
}

export interface DeathSaves {
  successes: number;
  failures: number;
  isStable?: boolean;
}

export type CoverType = 'none' | 'half' | 'three_quarters' | 'total';

export interface CoverInfo {
  type: CoverType;
  acBonus: number;
  dexSaveBonus: number;
  canBeTargeted: boolean;
}

export type VisionType = 'normal' | 'darkvision' | 'blindsight' | 'truesight';

export interface VisionInfo {
  type: VisionType;
  range: number; // feet
}

export type ObscurementLevel = 'clear' | 'lightly_obscured' | 'heavily_obscured';

export type FightingStyleName =
  | 'defense'
  | 'dueling'
  | 'great_weapon_fighting'
  | 'protection'
  | 'archery'
  | 'two_weapon_fighting'
  | 'blessed_warrior'
  | 'blind_fighting';

export interface FightingStyle {
  name: FightingStyleName;
  description: string;
  effect: {
    acBonus?: number;
    attackBonus?: number;
    damageBonus?: number;
    rerollDamage?: boolean;
    protectionReaction?: boolean;
  };
}

export interface WeaponProperties {
  light?: boolean;
  finesse?: boolean;
  thrown?: boolean;
  twoHanded?: boolean;
  versatile?: boolean;
  reach?: boolean;
  heavy?: boolean;
  loading?: boolean;
  // Additional weapon properties that affect attacks
  ammunition?: boolean;
  range?: {
    normal: number;
    long?: number;
  };
  special?: string; // Special properties description
  magical?: boolean; // Magical weapon
  silvered?: boolean; // Silvered weapon
  adamantine?: boolean; // Adamantine weapon
}
