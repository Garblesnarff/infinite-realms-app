/* eslint-disable max-lines */
/**
 * Combat Schema
 *
 * Database tables for D&D 5E combat system including encounters, participants,
 * HP tracking, conditions, damage logging, and attack resolution.
 *
 * This schema matches the unified migration: 20251112_01_add_combat_system_unified.sql
 */

import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  index,
  jsonb,
  unique,
} from 'drizzle-orm/pg-core';

import { gameSessions, characters } from './game';
import { npcs } from './world';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/** A player action held until its declared actor reaches the current turn. */
export interface PendingCombatIntent {
  actorId: string;
  actionType: string;
  targetIds: string[];
  sourceText: string;
  queuedOnTurn: number;
  queuedOnRound: number;
}

/**
 * Combat Encounters Table
 * Tracks combat encounters within game sessions with round and turn order management
 */
export const combatEncounters = pgTable(
  'combat_encounters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),

    // Combat state
    status: text('status').notNull().default('active'), // 'active' | 'paused' | 'completed'
    /**
     * Why this encounter stopped. Written by the same statement that writes `completed`, so a
     * terminal encounter with no reason is not a state the code can produce.
     *
     * Run 18's encounter 2 was marked `completed` with a hostile alive at 2 of 11 HP, no
     * `combat_ended` telemetry, and nothing in the DM's context to say a fight had ended. The
     * row could not say which of the four terminating paths had run, so the abandonment was
     * indistinguishable from a victory after the fact.
     */
    endedReason: text('ended_reason'),
    currentRound: integer('current_round').notNull().default(1),
    currentTurnOrder: integer('current_turn_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    pendingIntent: jsonb('pending_intent').$type<PendingCombatIntent | null>(),

    // Optional metadata
    location: text('location'),
    difficulty: text('difficulty'), // 'easy' | 'medium' | 'hard' | 'deadly'
    experienceAwarded: integer('experience_awarded'),

    // Timestamps
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index('idx_combat_encounters_session').on(table.sessionId),
    statusIdx: index('idx_combat_encounters_status').on(table.status),
  }),
);

/**
 * Combat Participants Table
 * Stores participants (PCs, NPCs, monsters) in combat encounters with combat statistics
 */
export const combatParticipants = pgTable(
  'combat_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => combatEncounters.id, { onDelete: 'cascade' }),

    // Entity references
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'set null' }),
    npcId: uuid('npc_id').references(() => npcs.id, { onDelete: 'set null' }),

    // Basic info
    name: text('name').notNull(),
    participantType: text('participant_type').notNull(), // 'player' | 'npc' | 'enemy' | 'monster'

    // Initiative and turn order
    initiative: integer('initiative').notNull().default(0),
    initiativeModifier: integer('initiative_modifier').notNull().default(0),
    turnOrder: integer('turn_order').notNull(),
    isActive: boolean('is_active').notNull().default(true),

    // Combat statistics. NULL armor_class means unset — AC 10 is a legal unarmored
    // value and must never be used as an in-band sentinel (#1871).
    armorClass: integer('armor_class'),
    maxHp: integer('max_hp').notNull().default(10),
    speed: integer('speed').notNull().default(30),

    // Persisted per-turn resources. These are reset when this participant's turn begins,
    // so reconnects restore the exact action-economy state instead of reconstructing it.
    resourcesRound: integer('resources_round').notNull().default(0),
    actionUsed: boolean('action_used').notNull().default(false),
    bonusActionUsed: boolean('bonus_action_used').notNull().default(false),
    reactionUsed: boolean('reaction_used').notNull().default(false),
    isDodging: boolean('is_dodging').notNull().default(false),
    isDisengaged: boolean('is_disengaged').notNull().default(false),

    // Damage modifiers
    damageResistances: text('damage_resistances').array().default([]),
    damageImmunities: text('damage_immunities').array().default([]),
    damageVulnerabilities: text('damage_vulnerabilities').array().default([]),

    // Additional data
    multiclassInfo: jsonb('multiclass_info'),

    /**
     * The attack profile this combatant fights with, resolved once at combat start.
     *
     * Resolved-and-stored rather than looked up at attack time because the resolution needs
     * the campaign's authored bible AND the SRD catalog AND the combatant's `monster_id` —
     * and `monster_id` is not a column here, so an attack-time lookup would have to re-derive
     * the creature from its display name. That fails on exactly the names combat produces:
     * `Shadow Roach 2` normalizes to a key no catalog holds. Storing the resolved profile
     * also records WHICH rung of the ladder it came from, which is the thing worth auditing.
     *
     * Nullable: a participant created before this column existed, or a DM improvisation that
     * resolved to nothing, has no profile and falls back to the generic default.
     * See services/combat/monster-attack-profile.ts.
     */
    monsterAttack: jsonb('monster_attack'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    encounterIdx: index('idx_combat_participants_encounter').on(table.encounterId),
    turnOrderIdx: index('idx_combat_participants_turn_order').on(
      table.encounterId,
      table.turnOrder,
    ),
    characterIdx: index('idx_combat_participants_character').on(table.characterId),
    npcIdx: index('idx_combat_participants_npc').on(table.npcId),
    initiativeIdx: index('idx_combat_participants_initiative').on(
      table.encounterId,
      table.initiative,
    ),
  }),
);

/**
 * Combat Participant Status Table
 * Tracks current HP, temp HP, consciousness, and death saves
 * Separated from participants for better data organization
 */
export const combatParticipantStatus = pgTable(
  'combat_participant_status',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => combatParticipants.id, { onDelete: 'cascade' }),

    // Hit points
    currentHp: integer('current_hp').notNull(),
    maxHp: integer('max_hp').notNull(),
    tempHp: integer('temp_hp').notNull().default(0),

    // Consciousness and death saves
    isConscious: boolean('is_conscious').notNull().default(true),
    deathSavesSuccesses: integer('death_saves_successes').notNull().default(0),
    deathSavesFailures: integer('death_saves_failures').notNull().default(0),

    // Exhaustion level (0-6)
    exhaustionLevel: integer('exhaustion_level').notNull().default(0),

    // Timestamp
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    participantIdx: index('idx_combat_participant_status_participant').on(table.participantId),
    uniqueParticipant: unique('unique_participant_status').on(table.participantId),
  }),
);

/**
 * Combat Damage Log Table
 * Tracks all damage dealt during combat for analytics and history
 */
export const combatDamageLog = pgTable(
  'combat_damage_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    encounterId: uuid('encounter_id')
      .notNull()
      .references(() => combatEncounters.id, { onDelete: 'cascade' }),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => combatParticipants.id, { onDelete: 'cascade' }),

    // Damage details
    damageAmount: integer('damage_amount').notNull(),
    damageType: text('damage_type').notNull(),

    // Source tracking
    sourceParticipantId: uuid('source_participant_id').references(() => combatParticipants.id, {
      onDelete: 'set null',
    }),
    sourceDescription: text('source_description'),

    // Round tracking
    roundNumber: integer('round_number').notNull(),

    // Timestamp
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    encounterIdx: index('idx_combat_damage_log_encounter').on(table.encounterId),
    participantIdx: index('idx_combat_damage_log_participant').on(table.participantId),
    roundIdx: index('idx_combat_damage_log_round').on(table.encounterId, table.roundNumber),
  }),
);

/**
 * Conditions Library Table
 * Reference table for all D&D 5E conditions with mechanical effects
 */
export const conditionsLibrary = pgTable(
  'conditions_library',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull().unique(),
    description: text('description').notNull(),
    mechanicalEffects: text('mechanical_effects').notNull(),
    iconName: text('icon_name'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    nameIdx: index('idx_conditions_library_name').on(table.name),
  }),
);

/**
 * Combat Participant Conditions Table
 * Tracks active conditions applied to combat participants
 */
export const combatParticipantConditions = pgTable(
  'combat_participant_conditions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    participantId: uuid('participant_id')
      .notNull()
      .references(() => combatParticipants.id, { onDelete: 'cascade' }),
    conditionId: uuid('condition_id')
      .notNull()
      .references(() => conditionsLibrary.id, { onDelete: 'cascade' }),

    // Duration tracking
    durationType: text('duration_type').notNull(), // 'rounds' | 'minutes' | 'hours' | 'until_save' | 'permanent'
    durationValue: integer('duration_value'),

    // Save mechanics
    saveDc: integer('save_dc'),
    saveAbility: text('save_ability'), // 'strength' | 'dexterity' | 'constitution' | 'intelligence' | 'wisdom' | 'charisma'

    // Timing
    appliedAtRound: integer('applied_at_round').notNull(),
    expiresAtRound: integer('expires_at_round'),

    // Source and state
    sourceDescription: text('source_description'),
    isActive: boolean('is_active').notNull().default(true),

    // Timestamp
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    participantIdx: index('idx_conditions_participant').on(table.participantId),
    activeIdx: index('idx_conditions_active').on(table.participantId, table.isActive),
    expiryIdx: index('idx_conditions_expiry').on(table.expiresAtRound, table.isActive),
  }),
);

/**
 * Creature Stats Table
 * Stores AC, resistances, vulnerabilities, and immunities for characters and NPCs
 * Used for attack resolution
 */
export const creatureStats = pgTable(
  'creature_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'cascade' }),
    npcId: uuid('npc_id').references(() => npcs.id, { onDelete: 'cascade' }),

    // Combat statistics
    armorClass: integer('armor_class').notNull().default(10),
    resistances: text('resistances').array().default([]),
    vulnerabilities: text('vulnerabilities').array().default([]),
    immunities: text('immunities').array().default([]),
    conditionImmunities: text('condition_immunities').array().default([]),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    characterIdx: index('idx_creature_stats_character').on(table.characterId),
    npcIdx: index('idx_creature_stats_npc').on(table.npcId),
  }),
);

/**
 * Weapon Attacks Table
 * Stores weapon attack data for player characters
 */
export const weaponAttacks = pgTable(
  'weapon_attacks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    attackBonus: integer('attack_bonus').notNull(),
    damageDice: text('damage_dice').notNull(),
    damageBonus: integer('damage_bonus').notNull().default(0),
    damageType: text('damage_type').notNull(),
    properties: text('properties').array().default([]),
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    characterIdx: index('idx_weapon_attacks_character').on(table.characterId),
  }),
);

// =====================================================
// RELATIONS
// =====================================================

export const combatEncountersRelations = relations(combatEncounters, ({ one, many }) => ({
  session: one(gameSessions, {
    fields: [combatEncounters.sessionId],
    references: [gameSessions.id],
  }),
  participants: many(combatParticipants),
  damageLog: many(combatDamageLog),
}));

export const combatParticipantsRelations = relations(combatParticipants, ({ one, many }) => ({
  encounter: one(combatEncounters, {
    fields: [combatParticipants.encounterId],
    references: [combatEncounters.id],
  }),
  character: one(characters, {
    fields: [combatParticipants.characterId],
    references: [characters.id],
  }),
  npc: one(npcs, {
    fields: [combatParticipants.npcId],
    references: [npcs.id],
  }),
  status: one(combatParticipantStatus, {
    fields: [combatParticipants.id],
    references: [combatParticipantStatus.participantId],
  }),
  conditions: many(combatParticipantConditions),
  damageReceived: many(combatDamageLog),
}));

export const combatParticipantStatusRelations = relations(combatParticipantStatus, ({ one }) => ({
  participant: one(combatParticipants, {
    fields: [combatParticipantStatus.participantId],
    references: [combatParticipants.id],
  }),
}));

export const combatDamageLogRelations = relations(combatDamageLog, ({ one }) => ({
  encounter: one(combatEncounters, {
    fields: [combatDamageLog.encounterId],
    references: [combatEncounters.id],
  }),
  participant: one(combatParticipants, {
    fields: [combatDamageLog.participantId],
    references: [combatParticipants.id],
  }),
  sourceParticipant: one(combatParticipants, {
    fields: [combatDamageLog.sourceParticipantId],
    references: [combatParticipants.id],
  }),
}));

export const conditionsLibraryRelations = relations(conditionsLibrary, ({ many }) => ({
  appliedConditions: many(combatParticipantConditions),
}));

export const combatParticipantConditionsRelations = relations(
  combatParticipantConditions,
  ({ one }) => ({
    participant: one(combatParticipants, {
      fields: [combatParticipantConditions.participantId],
      references: [combatParticipants.id],
    }),
    condition: one(conditionsLibrary, {
      fields: [combatParticipantConditions.conditionId],
      references: [conditionsLibrary.id],
    }),
  }),
);

export const creatureStatsRelations = relations(creatureStats, ({ one }) => ({
  character: one(characters, {
    fields: [creatureStats.characterId],
    references: [characters.id],
  }),
  npc: one(npcs, {
    fields: [creatureStats.npcId],
    references: [npcs.id],
  }),
}));

export const weaponAttacksRelations = relations(weaponAttacks, ({ one }) => ({
  character: one(characters, {
    fields: [weaponAttacks.characterId],
    references: [characters.id],
  }),
}));

// =====================================================
// TYPE EXPORTS
// =====================================================

export type CombatEncounter = InferSelectModel<typeof combatEncounters>;
export type NewCombatEncounter = InferInsertModel<typeof combatEncounters>;

export type CombatParticipant = InferSelectModel<typeof combatParticipants>;
export type NewCombatParticipant = InferInsertModel<typeof combatParticipants>;

export type CombatParticipantStatus = InferSelectModel<typeof combatParticipantStatus>;
export type NewCombatParticipantStatus = InferInsertModel<typeof combatParticipantStatus>;

export type CombatDamageLog = InferSelectModel<typeof combatDamageLog>;
export type NewCombatDamageLog = InferInsertModel<typeof combatDamageLog>;

export type ConditionLibrary = InferSelectModel<typeof conditionsLibrary>;
export type NewConditionLibrary = InferInsertModel<typeof conditionsLibrary>;

export type CombatParticipantCondition = InferSelectModel<typeof combatParticipantConditions>;
export type NewCombatParticipantCondition = InferInsertModel<typeof combatParticipantConditions>;

export type CreatureStats = InferSelectModel<typeof creatureStats>;
export type NewCreatureStats = InferInsertModel<typeof creatureStats>;

export type WeaponAttack = InferSelectModel<typeof weaponAttacks>;
export type NewWeaponAttack = InferInsertModel<typeof weaponAttacks>;
