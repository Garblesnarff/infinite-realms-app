/**
 * Combat encounters, state management, events, dice-roll requests, and
 * the CombatContext contract.
 */

import type {
  ActionType,
  CombatPhase,
  Condition,
  ConditionName,
  DamageType,
  ReactionOpportunity,
} from './combat-mechanics';
import type { CombatAction, CombatParticipant, DiceRoll } from './combat-participants';
import type { Equipment } from '@/data/equipmentOptions';

// ===========================
// Combat Encounter
// ===========================

export interface CombatEncounter {
  id: string;
  sessionId: string;

  // Status
  phase: CombatPhase;
  currentRound: number;
  currentTurnParticipantId?: string;
  pendingIntent?: {
    actorId: string;
    actionType: string;
    targetIds: string[];
    sourceText: string;
    queuedOnTurn: number;
    queuedOnRound: number;
  } | null;

  // Participants in initiative order
  participants: CombatParticipant[];

  // Environmental factors
  location?: string;
  environmentalEffects?: string[];
  visibility?: 'clear' | 'dim' | 'dark' | 'bright';
  terrain?: string; // "difficult", "rough", etc.

  // Combat log
  actions: CombatAction[];

  // Time tracking (narrative, not real-time)
  roundsElapsed: number;
  startTime: Date;
  endTime?: Date;

  // Metadata
  difficulty?: 'easy' | 'medium' | 'hard' | 'deadly';
  experienceAwarded?: number;

  /**
   * Where this encounter came from. `'server'` means it was hydrated from
   * `GET /v1/combat/sessions/:id/active` (or a `combat_state_updated` broadcast) and the
   * server is therefore allowed to end it by no longer reporting it. Anything else —
   * including the manual combat button, which mints a client-side encounter the server has
   * never heard of — is left alone by the authoritative sync.
   */
  origin?: 'server' | 'local';
}

// ===========================
// Combat State Management
// ===========================

export interface CombatState {
  activeEncounter: CombatEncounter | null;
  isInCombat: boolean;

  // UI State
  selectedParticipantId?: string;
  selectedTargetId?: string;
  showInitiativeTracker: boolean;
  showCombatLog: boolean;

  // Pending actions (before confirmation)
  pendingAction?: Partial<CombatAction>;

  // Reaction system
  activeReactionOpportunities: ReactionOpportunity[];
  pendingReactionResponse?: {
    opportunityId: string;
    selectedReaction?: ActionType;
  };

  // Dice roll management
  diceRollQueue: DiceRollQueue;
}

// ===========================
// Combat Events
// ===========================

export type CombatEvent =
  | { type: 'COMBAT_START'; encounter: CombatEncounter }
  | { type: 'COMBAT_END'; encounterId: string; reason: string }
  | { type: 'TURN_START'; participantId: string }
  | { type: 'TURN_END'; participantId: string }
  | { type: 'ROUND_START'; roundNumber: number }
  | { type: 'ACTION_TAKEN'; action: CombatAction }
  | { type: 'DAMAGE_DEALT'; participantId: string; damage: number }
  | { type: 'CONDITION_APPLIED'; participantId: string; condition: Condition }
  | { type: 'CONDITION_REMOVED'; participantId: string; conditionName: ConditionName }
  | { type: 'DEATH_SAVE'; participantId: string; result: 'success' | 'failure' }
  | { type: 'PARTICIPANT_UNCONSCIOUS'; participantId: string }
  | { type: 'PARTICIPANT_DEAD'; participantId: string }
  | { type: 'INITIATIVE_ROLLED'; participantId: string; initiative: number };

// ===========================
// Dice Roll Request Management
// ===========================

export type DiceRollRequestType =
  | 'initiative'
  | 'attack'
  | 'damage'
  | 'damage_taken' // Player receives damage from enemy - triggers HP update
  | 'saving_throw'
  | 'death_save'
  | 'concentration_save'
  | 'ability_check'
  | 'skill_check';

export interface DiceRollRequest {
  id: string;
  requestType: DiceRollRequestType;
  participantId?: string;
  description: string;
  rollConfig: {
    dieType: number;
    count: number;
    modifier: number;
    abilityModifier?: string; // symbolic ability name e.g. "cha", "int", "wis" — resolved by UI component
    advantage?: boolean;
    disadvantage?: boolean;
  };
  timestamp: Date;
  status: 'pending' | 'completed' | 'cancelled';
  result?: DiceRoll;
  batchId?: string; // Groups multiple rolls from same AI request for batching
  dc?: number; // Target DC for ability checks and saving throws
  ac?: number; // Target AC for attack rolls
  // Fields for damage_taken type (incoming damage to player)
  target?: string; // "player" or NPC name - who receives the damage
  damageType?: DamageType; // Type of damage (fire, cold, slashing, etc.)
  /**
   * Set when this roll is the player's own attack die for an engine attack that is waiting on
   * it. Such a roll settles the combat resolution directly and must NOT be sent to the DM as a
   * chat message: the turn it belongs to is already in flight, and narrating the die as a new
   * player utterance would resolve the same attack twice.
   */
  combatAttackRoll?: boolean;
  /** Set when this d20 belongs to the ask-first combat-entry initiative prompt. */
  combatInitiativeRoll?: boolean;
}

export interface DiceRollQueue {
  pendingRolls: DiceRollRequest[];
  currentRollId?: string;
  isProcessingRoll: boolean;
  currentBatchId?: string; // Current active batch ID
  completedBatchRolls: DiceRollRequest[]; // Completed rolls in current batch
}

// ===========================
// Helper Types
// ===========================

export interface CombatContextValue {
  state: CombatState;

  // Combat management
  startCombat: (
    sessionId: string,
    initialParticipants: Partial<CombatParticipant>[],
  ) => Promise<void>;
  endCombat: () => Promise<void>;

  /**
   * Re-reads the encounter from the server and reconciles it into combat state, returning the
   * encounter that is live *right now* rather than whatever the last dispatch left behind.
   * Callers that must not act on a stale render (the DM turn pipeline) await this first.
   */
  refreshCombatState: () => Promise<CombatEncounter | null>;

  // Turn management
  nextTurn: () => Promise<void>;
  rollInitiative: (participantId: string) => Promise<number>;

  // Actions
  takeAction: (action: Partial<CombatAction>) => Promise<void>;
  dealDamage: (participantId: string, damage: number, damageType?: DamageType) => Promise<void>;
  healDamage: (participantId: string, healing: number) => Promise<void>;

  // Conditions
  applyCondition: (participantId: string, condition: Condition) => Promise<void>;
  removeCondition: (participantId: string, conditionName: ConditionName) => Promise<void>;

  // Death saves
  rollDeathSave: (participantId: string) => Promise<'success' | 'failure' | 'critical'>;

  // Participants
  addParticipant: (participant: Partial<CombatParticipant>) => Promise<void>;
  removeParticipant: (participantId: string) => Promise<void>;
  updateParticipant: (participantId: string, updates: Partial<CombatParticipant>) => Promise<void>;

  // Reaction management
  addReactionOpportunity: (opportunity: ReactionOpportunity) => void;
  removeReactionOpportunity: (opportunityId: string) => void;
  clearReactionOpportunities: () => void;
  setPendingReaction: (opportunityId: string, selectedReaction: ActionType) => void;

  // Participant reaction opportunities
  addParticipantReactionOpportunity: (
    participantId: string,
    opportunity: ReactionOpportunity,
  ) => void;
  removeParticipantReactionOpportunity: (participantId: string, opportunityId: string) => void;
  clearParticipantReactionOpportunities: (participantId: string) => void;

  // Movement actions
  moveParticipant: (
    participantId: string,
    fromPosition: string,
    toPosition: string,
  ) => Promise<void>;

  // Weapon management
  equipMainHandWeapon: (participantId: string, weapon: Equipment) => void;
  equipOffHandWeapon: (participantId: string, weapon: Equipment) => void;
  unequipMainHandWeapon: (participantId: string) => void;
  unequipOffHandWeapon: (participantId: string) => void;
}
