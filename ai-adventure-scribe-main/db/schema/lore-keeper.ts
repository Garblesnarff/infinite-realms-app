/**
 * Lore Keeper Schema
 *
 * Database tables for the canonical campaign lore system.
 * These are READ-ONLY starter campaigns that Franz (AI DM) queries via RAG.
 * Users cannot modify this content - it's the canonical "bible" for each campaign.
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
  customType,
} from 'drizzle-orm/pg-core';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Custom vector type for pgvector embeddings
 */
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Parse "[0.1,0.2,...]" format from Postgres
    return JSON.parse(value.replace(/^\[/, '[').replace(/\]$/, ']'));
  },
});

/**
 * Enums
 */
export const difficultyEnum = pgEnum('campaign_difficulty', [
  'easy',
  'low-medium',
  'medium',
  'medium-hard',
  'hard',
  'deadly',
]);

export const chunkTypeEnum = pgEnum('chunk_type', [
  'creative_brief',
  'world_building',
  'faction',
  'npc_tier1',
  'npc_tier2',
  'npc_tier3',
  'location',
  'quest_main',
  'quest_side',
  'mechanic',
  'item',
  'encounter',
  'session_outline',
]);

export const ruleTypeEnum = pgEnum('rule_type', ['causality', 'mechanic', 'world_law']);

export const playstyleEnum = pgEnum('playstyle', [
  'roleplay-heavy',
  'combat-focused',
  'balanced',
  'exploration',
  'puzzle-solving',
]);

/**
 * Starter Campaigns Table
 * Canonical campaign templates from the external repo.
 * These are READ-ONLY - users cannot modify them.
 */
export const starterCampaigns = pgTable(
  'starter_campaigns',
  {
    // Identity - matches directory name from repo
    id: text('id').primaryKey(), // e.g., "a_midsummer_nights_chaos"
    slug: text('slug').unique().notNull(),
    title: text('title').notNull(),
    tagline: text('tagline'), // Short hook for cards

    // Classification
    genre: text('genre').array().notNull(), // ["fae", "comedy", "romance"]
    subGenre: text('sub_genre').array(), // ["shakespearean", "farce"]
    tone: text('tone').array().notNull(), // ["fae mischief", "love gone wrong"]
    difficulty: difficultyEnum('difficulty').notNull(),
    levelRange: text('level_range'), // "1-8"
    estimatedSessions: text('estimated_sessions'), // "8-10"

    // Content (full text for display, NOT for RAG)
    premise: text('premise').notNull(), // 2-3 sentence hook
    creativeBrief: text('creative_brief'), // Full art/voice/music direction
    overview: text('overview'), // Full campaign summary

    // Status & Release
    isComplete: boolean('is_complete').default(false).notNull(),
    isPublished: boolean('is_published').default(false).notNull(),
    isFeatured: boolean('is_featured').default(false).notNull(),
    releaseDate: timestamp('release_date', { withTimezone: true, mode: 'date' }),
    releaseEvent: text('release_event'), // "Launch", "Halloween 2025", etc.

    // Versioning
    currentVersion: integer('current_version').default(1).notNull(),

    // Assets (pre-generated)
    coverImageUrl: text('cover_image_url'),
    bannerImageUrl: text('banner_image_url'),
    galleryImages: jsonb('gallery_images'), // [{url, caption, location}]

    // Stats (future use)
    playCount: integer('play_count').default(0),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: index('idx_starter_campaigns_slug').on(table.slug),
    genreIdx: index('idx_starter_campaigns_genre').on(table.genre),
    difficultyIdx: index('idx_starter_campaigns_difficulty').on(table.difficulty),
    publishedIdx: index('idx_starter_campaigns_published').on(table.isPublished, table.isComplete),
    featuredIdx: index('idx_starter_campaigns_featured').on(table.isFeatured),
  })
);

/**
 * Campaign Chunks Table
 * Chunked lore for RAG retrieval.
 * Each chunk is an atomic, queryable piece of campaign lore.
 */
export const campaignChunks = pgTable(
  'campaign_chunks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => starterCampaigns.id, { onDelete: 'cascade' }),

    // Classification
    chunkType: chunkTypeEnum('chunk_type').notNull(),
    entityName: text('entity_name'), // "Puck", "Titania's Bower"
    parentEntity: text('parent_entity'), // "Court of Stolen Breath" for faction members

    // Content
    content: text('content').notNull(),
    summary: text('summary'), // One-line summary for quick display

    // Vector embedding for semantic search
    embedding: vector('embedding'),

    // Metadata
    metadata: jsonb('metadata').default({}), // tier, zone, quest_type, etc.
    sourceFile: text('source_file'), // "campaign_bible.md"
    sourceSection: text('source_section'), // "## NPCs > Tier 1"

    // Ordering (for session outlines, quest beats)
    sequenceOrder: integer('sequence_order'),

    // Versioning - matches campaign version when created
    version: integer('version').default(1).notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    campaignIdIdx: index('idx_campaign_chunks_campaign_id').on(table.campaignId),
    typeIdx: index('idx_campaign_chunks_type').on(table.campaignId, table.chunkType),
    entityIdx: index('idx_campaign_chunks_entity').on(table.campaignId, table.entityName),
    // Vector index created in SQL migration (Drizzle doesn't support ivfflat directly)
  })
);

/**
 * Campaign Rules Table
 * Causality/IF-THEN rules extracted from world building specs.
 * These govern world consequences and help Franz make consistent decisions.
 */
export const campaignRules = pgTable(
  'campaign_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => starterCampaigns.id, { onDelete: 'cascade' }),

    // Classification
    ruleType: ruleTypeEnum('rule_type').notNull(),

    // The rule itself
    condition: text('condition').notNull(), // "Oberon and Titania remain at war"
    effect: text('effect').notNull(), // "seasons fail and nature suffers"

    // Metadata
    reversible: boolean('reversible').default(true).notNull(),
    priority: integer('priority').default(5).notNull(), // 1-10, higher = more important
    metadata: jsonb('metadata').default({}),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    campaignIdIdx: index('idx_campaign_rules_campaign_id').on(table.campaignId),
    typeIdx: index('idx_campaign_rules_type').on(table.campaignId, table.ruleType),
  })
);

/**
 * Campaign Parties Table
 * Pre-built party options for starter campaigns.
 * Users can select these for immediate play without character creation.
 */
export const campaignParties = pgTable(
  'campaign_parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => starterCampaigns.id, { onDelete: 'cascade' }),

    // Identity
    partyName: text('party_name').notNull(), // "The Star-Crossed Nobles"
    partyConcept: text('party_concept').notNull(), // 2-3 sentences on who they are
    partyHook: text('party_hook').notNull(), // Why they're entering this story

    // Classification
    playstyle: playstyleEnum('playstyle').notNull(),
    isDefault: boolean('is_default').default(false).notNull(), // Show this one first

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    campaignIdIdx: index('idx_campaign_parties_campaign_id').on(table.campaignId),
    defaultIdx: index('idx_campaign_parties_default').on(table.campaignId, table.isDefault),
  })
);

/**
 * Party Characters Table
 * Individual character sheets for pre-built parties.
 * Stats stored in universal/abstract format for multi-ruleset support.
 */
export const partyCharacters = pgTable(
  'party_characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    partyId: uuid('party_id')
      .notNull()
      .references(() => campaignParties.id, { onDelete: 'cascade' }),

    // Identity
    characterName: text('character_name').notNull(),
    race: text('race').notNull(),
    characterClass: text('class').notNull(),
    level: integer('level').default(1).notNull(),

    // Narrative
    backstory: text('backstory').notNull(), // 2-3 sentences
    personality: text('personality').notNull(), // Traits, flaws, bonds
    campaignHook: text('campaign_hook').notNull(), // Personal stake in THIS story
    partyRelationship: text('party_relationship'), // Connection to other party members

    // Stats - Universal/abstract format for multi-ruleset support
    // Translation to specific rulesets happens at runtime
    stats: jsonb('stats').notNull(),
    /*
      Example stats format:
      {
        "attributes": {
          "strength": 16,
          "dexterity": 14,
          "constitution": 15,
          "intelligence": 10,
          "wisdom": 12,
          "charisma": 8
        },
        "archetype": "warrior-tank",
        "combat_style": "melee-defensive",
        "special_abilities": ["shield_bash", "taunt"],
        "proficiencies": ["heavy_armor", "shields", "martial_weapons"]
      }
    */

    // Art (for future image generation)
    portraitPrompt: text('portrait_prompt'),
    portraitUrl: text('portrait_url'),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    partyIdIdx: index('idx_party_characters_party_id').on(table.partyId),
    nameIdx: index('idx_party_characters_name').on(table.characterName),
  })
);

// Define relations
export const starterCampaignsRelations = relations(starterCampaigns, ({ many }) => ({
  chunks: many(campaignChunks),
  rules: many(campaignRules),
  parties: many(campaignParties),
}));

export const campaignChunksRelations = relations(campaignChunks, ({ one }) => ({
  campaign: one(starterCampaigns, {
    fields: [campaignChunks.campaignId],
    references: [starterCampaigns.id],
  }),
}));

export const campaignRulesRelations = relations(campaignRules, ({ one }) => ({
  campaign: one(starterCampaigns, {
    fields: [campaignRules.campaignId],
    references: [starterCampaigns.id],
  }),
}));

export const campaignPartiesRelations = relations(campaignParties, ({ one, many }) => ({
  campaign: one(starterCampaigns, {
    fields: [campaignParties.campaignId],
    references: [starterCampaigns.id],
  }),
  characters: many(partyCharacters),
}));

export const partyCharactersRelations = relations(partyCharacters, ({ one }) => ({
  party: one(campaignParties, {
    fields: [partyCharacters.partyId],
    references: [campaignParties.id],
  }),
}));

// Type exports for TypeScript inference
export type StarterCampaign = InferSelectModel<typeof starterCampaigns>;
export type NewStarterCampaign = InferInsertModel<typeof starterCampaigns>;

export type CampaignChunk = InferSelectModel<typeof campaignChunks>;
export type NewCampaignChunk = InferInsertModel<typeof campaignChunks>;

export type CampaignRule = InferSelectModel<typeof campaignRules>;
export type NewCampaignRule = InferInsertModel<typeof campaignRules>;

export type CampaignParty = InferSelectModel<typeof campaignParties>;
export type NewCampaignParty = InferInsertModel<typeof campaignParties>;

export type PartyCharacter = InferSelectModel<typeof partyCharacters>;
export type NewPartyCharacter = InferInsertModel<typeof partyCharacters>;

// Chunk type constants for use in queries
export const CHUNK_TYPES = {
  CREATIVE_BRIEF: 'creative_brief',
  WORLD_BUILDING: 'world_building',
  FACTION: 'faction',
  NPC_TIER1: 'npc_tier1',
  NPC_TIER2: 'npc_tier2',
  NPC_TIER3: 'npc_tier3',
  LOCATION: 'location',
  QUEST_MAIN: 'quest_main',
  QUEST_SIDE: 'quest_side',
  MECHANIC: 'mechanic',
  ITEM: 'item',
  ENCOUNTER: 'encounter',
  SESSION_OUTLINE: 'session_outline',
} as const;

// Universal character stats interface
export interface UniversalCharacterStats {
  attributes: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  archetype: string; // "warrior-tank", "spellcaster-control", etc.
  combatStyle: string; // "melee-defensive", "ranged-burst", etc.
  specialAbilities: string[];
  proficiencies: string[];
}
