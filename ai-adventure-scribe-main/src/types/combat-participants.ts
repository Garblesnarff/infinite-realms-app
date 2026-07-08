/**
 * Combat participants, monster attacks, dice rolls, and per-turn actions.
 */

import type {
  CharacterResources,
  ClassFeature,
  RacialTrait,
  SpellSlotConfig,
  SpellSlotLevel,
} from './combat-features';
import type {
  ActionType,
  Condition,
  CoverInfo,
  DamageType,
  FightingStyle,
  ObscurementLevel,
  ReactionOpportunity,
  VisionInfo,
} from './combat-mechanics';
import type { Equipment } from '@/data/equipmentOptions';

// ===========================
// Combat Participants
// ===========================

export interface CombatParticipant {
  id: string;
  name: string;
  participantType: 'player' | 'enemy' | 'npc';
  characterId?: string;
  characterClass?: string;
  level?: number;

  // Visual assets (from campaign chunks)
  portraitUrl?: string;
  assetKey?: string;

  // Combat stats
  maxHitPoints: number;
  currentHitPoints: number;
  temporaryHitPoints: number;
  armorClass: number;
  initiative: number;
  initiativeBonus?: number;
  abilityScores?: {
    strength?: { modifier?: number };
    dexterity?: { modifier?: number };
    constitution?: { modifier?: number; savingThrow?: boolean };
  };
  speed: number;

  // Turn tracking
  actionTaken: boolean;
  bonusActionTaken: boolean;
  reactionTaken: boolean;
  movementUsed: number;

  // Foundry VTT integration
  position?: { x: number; y: number; sceneId: string };
  tokenId?: string;
  movementRemaining: number;

  // Reaction tracking
  reactionOpportunities: ReactionOpportunity[];

  // Combat state
  conditions: Condition[];
  deathSaves: {
    successes: number;
    failures: number;
  };
  isStable?: boolean;
  isDead?: boolean;
  isUnconscious?: boolean;

  // Weapon tracking
  mainHandWeapon?: Equipment;
  offHandWeapon?: Equipment;

  // Class features
  classFeatures?: ClassFeature[];
  resources?: CharacterResources;
  isRaging?: boolean; // Track if Barbarian is currently raging
  activeConcentration?: string | null;

  // Spellcasting
  spellSlots?: Record<SpellSlotLevel, SpellSlotConfig>;
  preparedSpells?: string[];

  // Damage resistances, immunities, and vulnerabilities
  damageResistances: DamageType[];
  damageImmunities: DamageType[];
  damageVulnerabilities: DamageType[];

  // Fighting styles
  fightingStyles?: FightingStyle[];

  // Racial traits
  racialTraits?: RacialTrait[];

  // Vision and stealth
  visionTypes?: VisionInfo[];
  obscurement?: ObscurementLevel;
  isHidden?: boolean;
  stealthCheckBonus?: number;

  // Cover (used for AC calculation - see utils/fightingStyles.ts getTotalAC)
  cover?: CoverInfo;

  // Monster data for detected enemies
  monsterData?: {
    type: string;
    challengeRating: string;
    alignment: string;
    specialAbilities: string[];
    attacks: MonsterAttack[];
  };
}

export interface MonsterAttack {
  name: string;
  attackBonus: number;
  damageRoll: string; // "1d8+3"
  damageType: DamageType;
  reach: number;
  description: string;
}

// ===========================
// Combat Actions & Rolls
// ===========================

export interface DiceRoll {
  dieType: number; // d4, d6, d8, d10, d12, d20
  count: number;
  modifier: number;
  results: number[]; // All dice rolled (for advantage/disadvantage, includes all dice)
  keptResults: number[]; // Which dice were actually used
  total: number;
  advantage?: boolean;
  disadvantage?: boolean;
  critical?: boolean;
  naturalRoll?: number; // The natural die result before modifiers (for critical detection)
  isRageBonus?: boolean; // Marks a roll that already includes a Barbarian rage bonus
}

export interface CombatAction {
  id: string;
  encounterId: string;
  participantId: string;
  targetParticipantId?: string;

  // Turn tracking
  round: number;
  turnOrder: number;

  // Action details
  actionType: ActionType;
  description: string;

  // Spell-specific information
  spellName?: string;
  spellLevel?: number;
  components?: {
    verbal?: boolean;
    somatic?: boolean;
    material?: boolean;
    materialDescription?: string;
    materialCost?: number;
    materialConsumed?: boolean;
  };

  // Dice rolls made
  attackRoll?: DiceRoll;
  damageRolls?: DiceRoll[];
  savingThrows?: DiceRoll[];

  // Results
  hit?: boolean;
  damageDealt?: number;
  damageType?: DamageType;
  conditionsApplied?: Condition[];

  // Supplementary state-change details (damage/heal side effects)
  effects?: {
    newHitPoints?: number;
    unconscious?: boolean;
    concentrationLost?: boolean;
    revivedFromUnconscious?: boolean;
  };

  // Narrative (from AI DM)
  dmNarration?: string;

  timestamp: Date;
}
