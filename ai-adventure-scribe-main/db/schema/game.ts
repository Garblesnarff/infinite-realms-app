/* eslint-disable max-lines */
/**
 * Game Core Schema
 *
 * Database tables for core D&D game elements.
 * Includes campaigns, characters, character stats, and game sessions.
 */

import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  boolean,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core';

import { conditionsLibrary } from './combat';
import { characterHitDice } from './rest';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Enums
 */
export const sharingModeEnum = pgEnum('sharing_mode', [
  'private',
  'view_only',
  'can_edit',
  'co_owner',
]);

/**
 * Campaigns Table
 * Stores D&D campaign configurations and settings
 */
export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(), // References auth.users(id)
    name: text('name').notNull(),
    description: text('description'),
    genre: text('genre'),
    difficultyLevel: text('difficulty_level'),
    campaignLength: text('campaign_length'),
    tone: text('tone'),
    era: text('era'),
    location: text('location'),
    atmosphere: text('atmosphere'),
    settingDetails: jsonb('setting_details'),
    thematicElements: jsonb('thematic_elements'),
    status: text('status').default('active').notNull(),
    backgroundImage: text('background_image'),
    artStyle: text('art_style'),
    styleConfig: jsonb('style_config'),
    rulesConfig: jsonb('rules_config'),
    template: boolean('template').default(false).notNull(),
    visibility: text('visibility').default('private').notNull(),
    templateVersion: integer('template_version').default(1).notNull(),
    thumbnailUrl: text('thumbnail_url'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
    // References starter_campaigns when this user-owned campaign was created from Explore.
    starterCampaignId: text('starter_campaign_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index('idx_campaigns_user_id').on(table.userId),
    statusIdx: index('idx_campaigns_status').on(table.status),
    starterCampaignIdx: index('idx_campaigns_starter_campaign').on(table.starterCampaignId),
  }),
);

/**
 * Characters Table
 * Stores D&D character sheets with all attributes, spells, and metadata
 */
export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull(), // References auth.users(id) - stored as text in Supabase
    campaignId: uuid('campaign_id'), // References campaigns table
    name: text('name').notNull(),
    description: text('description'),
    race: text('race'),
    subrace: text('subrace'),
    class: text('class'),
    level: integer('level').default(1).notNull(),
    alignment: text('alignment'),
    experiencePoints: integer('experience_points').default(0),
    background: text('background'),
    skillProficiencies: text('skill_proficiencies'),
    expertiseProficiencies: text('expertise_proficiencies'),
    toolProficiencies: text('tool_proficiencies'),
    savingThrowProficiencies: text('saving_throw_proficiencies'),
    languages: text('languages').array(),
    // AI-generated content
    imageUrl: text('image_url'),
    avatarUrl: text('avatar_url'),
    backgroundImage: text('background_image'),
    appearance: text('appearance'),
    personalityTraits: text('personality_traits'),
    personalityNotes: text('personality_notes'),
    backstoryElements: text('backstory_elements'),
    theme: text('theme'),
    sessionNotes: text('session_notes'),
    // Spell data (comma-separated text fields)
    cantrips: text('cantrips'),
    knownSpells: text('known_spells'),
    preparedSpells: text('prepared_spells'),
    ritualSpells: text('ritual_spells'),
    spellSlots: jsonb('spell_slots'),
    pactSlots: jsonb('pact_slots'),
    activeConcentration: text('active_concentration'),
    classFeatures: jsonb('class_features'),
    fightingStyles: jsonb('fighting_styles'),
    copperPieces: integer('copper_pieces').default(0),
    silverPieces: integer('silver_pieces').default(0),
    electrumPieces: integer('electrum_pieces').default(0),
    goldPieces: integer('gold_pieces').default(0),
    platinumPieces: integer('platinum_pieces').default(0),
    damageResistances: jsonb('damage_resistances'),
    damageImmunities: jsonb('damage_immunities'),
    damageVulnerabilities: jsonb('damage_vulnerabilities'),
    classLevels: jsonb('class_levels'),
    totalLevel: integer('total_level'),
    // Vision and stealth
    visionTypes: text('vision_types').array(),
    obscurement: text('obscurement'),
    isHidden: boolean('is_hidden').default(false),
    stealthCheckBonus: integer('stealth_check_bonus').default(0),
    // Sharing and permissions (Phase 1.5 - Foundry VTT integration)
    ownerId: text('owner_id'), // References auth.users(id) - defaults to user_id for backward compatibility
    isPublic: boolean('is_public').default(false).notNull(),
    sharingMode: sharingModeEnum('sharing_mode').default('private').notNull(),
    folderId: uuid('folder_id'), // References character_folders table
    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => ({
    userIdIdx: index('idx_characters_user_id').on(table.userId),
    campaignIdIdx: index('idx_characters_campaign_id').on(table.campaignId),
    nameIdx: index('idx_characters_name').on(table.name),
    createdAtIdx: index('idx_characters_created_at').on(table.createdAt),
    ownerIdIdx: index('idx_characters_owner_id').on(table.ownerId),
    isPublicIdx: index('idx_characters_is_public').on(table.isPublic),
    folderIdIdx: index('idx_characters_folder_id').on(table.folderId),
  }),
);

/**
 * The four states a character's body can be in.
 *
 * `is_conscious` alone cannot tell "unconscious and rolling death saves" apart from
 * "unconscious but stable" or "dead", and those have to be distinguishable before
 * anything downstream can react to a character dropping outside combat (#1826).
 */
export type VitalState = 'standing' | 'dying' | 'stabilized' | 'dead';

/**
 * Character Stats Table
 * Stores ability scores and related statistics for characters
 */
export const characterStats = pgTable(
  'character_stats',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    strength: integer('strength').default(10).notNull(),
    dexterity: integer('dexterity').default(10).notNull(),
    constitution: integer('constitution').default(10).notNull(),
    intelligence: integer('intelligence').default(10).notNull(),
    wisdom: integer('wisdom').default(10).notNull(),
    charisma: integer('charisma').default(10).notNull(),
    armorClass: integer('armor_class').default(10).notNull(),
    maxHitPoints: integer('max_hit_points').default(10).notNull(),
    currentHitPoints: integer('current_hit_points').default(10).notNull(),
    temporaryHitPoints: integer('temporary_hit_points').default(0),
    initiativeBonus: integer('initiative_bonus').default(0),
    speed: integer('speed').default(30),
    // Character-scoped vitals (#1826). These mirror the columns on
    // `combat_participant_status`, which only exist for the duration of an encounter —
    // a character who drops on a failed check outside combat has no participant row and
    // therefore, before these columns, no way to be unconscious at all.
    isConscious: boolean('is_conscious').default(true).notNull(),
    deathSavesSuccesses: integer('death_saves_successes').default(0).notNull(),
    deathSavesFailures: integer('death_saves_failures').default(0).notNull(),
    vitalState: text('vital_state').$type<VitalState>().default('standing').notNull(),
    diedAt: timestamp('died_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => ({
    characterIdIdx: index('idx_character_stats_character_id').on(table.characterId),
  }),
);

/**
 * Character Conditions Table
 * Conditions applied to a character, in or out of combat.
 *
 * The combat-scoped sibling (`combat_participant_conditions`) keys on a participant row
 * that only exists inside an encounter, and counts duration in rounds. Outside combat
 * there is no participant and there are no rounds, so this table keys on the character
 * and measures duration against the clock.
 */
export const characterConditions = pgTable(
  'character_conditions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    conditionId: uuid('condition_id')
      .notNull()
      .references(() => conditionsLibrary.id, { onDelete: 'cascade' }),

    // Duration tracking
    durationType: text('duration_type'), // 'minutes' | 'hours' | 'until_save' | 'permanent'
    durationValue: integer('duration_value'),

    // Timing
    appliedAt: timestamp('applied_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),

    // Source and state
    sourceDescription: text('source_description'),
    isActive: boolean('is_active').default(true),

    // Timestamp
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => ({
    characterIdx: index('idx_character_conditions_character').on(table.characterId),
    activeIdx: index('idx_character_conditions_active').on(table.isActive),
  }),
);

/**
 * Game Sessions Table
 * Individual play sessions within campaigns
 */
export const gameSessions = pgTable(
  'game_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id').references(() => characters.id, { onDelete: 'set null' }),
    sessionNumber: integer('session_number'),
    startTime: timestamp('start_time', { withTimezone: true, mode: 'date' }),
    endTime: timestamp('end_time', { withTimezone: true, mode: 'date' }),
    status: text('status').default('active'),
    currentSceneDescription: text('current_scene_description'),
    summary: text('summary'),
    sessionNotes: text('session_notes'),
    turnCount: integer('turn_count').default(0),
    sessionState: jsonb('session_state').default({}),
    // Starter campaign support
    starterCampaignId: text('starter_campaign_id'), // References starter_campaigns if this is a starter playthrough
    campaignVersion: integer('campaign_version'), // Locked version at session start
    ruleset: text('ruleset').default('5e'), // Game system (5e, OSE, Pathfinder, etc.)
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => ({
    campaignIdIdx: index('idx_game_sessions_campaign_id').on(table.campaignId),
    characterIdIdx: index('idx_game_sessions_character_id').on(table.characterId),
    statusIdx: index('idx_game_sessions_status').on(table.status),
    starterCampaignIdx: index('idx_game_sessions_starter_campaign').on(table.starterCampaignId),
  }),
);

/**
 * Characters controlled through the WebMCP companion surface for a session.
 *
 * The authoritative DDL is applied manually from the matching Supabase migration
 * after the PR merges. This Drizzle definition keeps the application schema and
 * sequential snapshot chain in agreement without making the server migration runner
 * the owner of that DDL.
 */
export const sessionCompanions = pgTable(
  'session_companions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    controller: text('controller').notNull().default('webmcp'),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    sessionCharacterUnique: unique('session_companions_session_character_unique').on(
      table.sessionId,
      table.characterId,
    ),
  }),
);

/**
 * Dialogue History Table
 * Chat messages during game sessions
 */
export const dialogueHistory = pgTable(
  'dialogue_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => gameSessions.id, { onDelete: 'cascade' }),
    speakerType: text('speaker_type'), // 'player', 'dm', 'npc'
    speakerId: uuid('speaker_id'), // References character or npc
    message: text('message').notNull(),
    // Client-supplied; display only.
    timestamp: timestamp('timestamp', { withTimezone: true, mode: 'date' }).defaultNow(),
    context: jsonb('context'),
    images: jsonb('images'),
    sequenceNumber: integer('sequence_number'),
    // Server clock — the only column safe to reason about time from.
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => ({
    sessionIdIdx: index('idx_dialogue_history_session_id').on(table.sessionId),
    timestampIdx: index('idx_dialogue_history_timestamp').on(table.timestamp),
  }),
);

/**
 * Session Chronicles Table
 * AI-generated fantasy prose chapters for completed game sessions.
 * Pro users get full illustrated chronicles; free users get plain summaries.
 */
export const sessionChronicles = pgTable(
  'session_chronicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    // 'pending' | 'generating' | 'ready' | 'failed'
    status: text('status').notNull().default('pending'),
    chronicleText: text('chronicle_text'),
    chapterTitle: text('chapter_title'),
    previouslyOn: text('previously_on'),
    illustrationUrl: text('illustration_url'),
    shareToken: text('share_token').unique(),
    generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'date' }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdIdx: index('idx_sc_session_id').on(table.sessionId),
    shareTokenIdx: index('idx_sc_share_token').on(table.shareToken),
    userIdIdx: index('idx_sc_user_id').on(table.userId),
  }),
);

export type SessionChronicle = InferSelectModel<typeof sessionChronicles>;
export type NewSessionChronicle = InferInsertModel<typeof sessionChronicles>;

// Define relations
export const charactersRelations = relations(characters, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [characters.campaignId],
    references: [campaigns.id],
  }),
  stats: one(characterStats, {
    fields: [characters.id],
    references: [characterStats.characterId],
  }),
  hitDice: many(characterHitDice),
  conditions: many(characterConditions),
}));

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  characters: many(characters),
}));

export const characterStatsRelations = relations(characterStats, ({ one }) => ({
  character: one(characters, {
    fields: [characterStats.characterId],
    references: [characters.id],
  }),
}));

export const characterConditionsRelations = relations(characterConditions, ({ one }) => ({
  character: one(characters, {
    fields: [characterConditions.characterId],
    references: [characters.id],
  }),
  condition: one(conditionsLibrary, {
    fields: [characterConditions.conditionId],
    references: [conditionsLibrary.id],
  }),
}));

// Type exports
export type Campaign = InferSelectModel<typeof campaigns>;
export type NewCampaign = InferInsertModel<typeof campaigns>;
export type Character = InferSelectModel<typeof characters>;
export type NewCharacter = InferInsertModel<typeof characters>;
export type CharacterStats = InferSelectModel<typeof characterStats>;
export type NewCharacterStats = InferInsertModel<typeof characterStats>;
export type CharacterCondition = InferSelectModel<typeof characterConditions>;
export type NewCharacterCondition = InferInsertModel<typeof characterConditions>;
export type GameSession = InferSelectModel<typeof gameSessions>;
export type NewGameSession = InferInsertModel<typeof gameSessions>;
export type SessionCompanion = InferSelectModel<typeof sessionCompanions>;
export type NewSessionCompanion = InferInsertModel<typeof sessionCompanions>;
export type DialogueHistory = InferSelectModel<typeof dialogueHistory>;
export type NewDialogueHistory = InferInsertModel<typeof dialogueHistory>;
