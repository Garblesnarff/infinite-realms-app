import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { campaigns, gameSessions } from './game';
import { starterCampaigns } from './lore-keeper';

/**
 * Story map (#1742, build step 1 #1752): the region map of one starter campaign, written at
 * ingest from its bible. One row per place; `place_key` is generateAssetKey(entity_name), the
 * same key campaign_chunks uses. x/y are in 0..1. The fight_* columns are the recipe a fight at
 * this place hands to the tactical generator (environment, size, seed).
 */
export const storyMapPlaces = pgTable(
  'story_map_places',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => starterCampaigns.id, { onDelete: 'cascade' }),
    placeKey: text('place_key').notNull(),
    name: text('name').notNull(),
    zoneKey: text('zone_key'),
    x: real('x').notNull(),
    y: real('y').notNull(),
    fightEnv: text('fight_env').notNull(),
    fightSize: text('fight_size').notNull(),
    fightSeed: integer('fight_seed').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    campaignPlaceUnique: uniqueIndex('story_map_places_campaign_place_key').on(
      table.campaignId,
      table.placeKey,
    ),
    fightSizeCheck: check(
      'story_map_places_fight_size_check',
      sql`${table.fightSize} in ('small', 'medium', 'large')`,
    ),
  }),
);

/**
 * One row per direction of travel: a two-way route (`A <-> B`) is two rows. A hidden route is
 * not shown to the player until the DM reveals it (build step 2).
 */
export const storyMapEdges = pgTable(
  'story_map_edges',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => starterCampaigns.id, { onDelete: 'cascade' }),
    fromKey: text('from_key').notNull(),
    toKey: text('to_key').notNull(),
    label: text('label'),
    hidden: boolean('hidden').notNull().default(false),
  },
  (table) => ({
    campaignEdgeUnique: uniqueIndex('story_map_edges_campaign_from_to').on(
      table.campaignId,
      table.fromKey,
      table.toKey,
    ),
    campaignIdx: index('idx_story_map_edges_campaign_id').on(table.campaignId),
  }),
);

/**
 * Story map discovery (#1753) for one player campaign: one row per place the player knows of
 * ('known') or has been to ('visited'). Kept on the campaign, not the session, so the next
 * session of the same playthrough opens with the same map. The current place is the 'visited'
 * row with the newest visited_at. RLS is off: every query joins campaigns and filters user_id.
 */
export const storyMapProgress = pgTable(
  'story_map_progress',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    placeKey: text('place_key').notNull(),
    state: text('state').notNull(),
    firstSessionId: uuid('first_session_id').references(() => gameSessions.id, {
      onDelete: 'set null',
    }),
    visitedAt: timestamp('visited_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    campaignPlaceUnique: uniqueIndex('story_map_progress_campaign_place_key').on(
      table.campaignId,
      table.placeKey,
    ),
    stateCheck: check(
      'story_map_progress_state_check',
      sql`${table.state} in ('known', 'visited')`,
    ),
  }),
);

/** A hidden route the player has found, for one player campaign (#1753). Both directions. */
export const storyMapRevealedEdges = pgTable(
  'story_map_revealed_edges',
  {
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    fromKey: text('from_key').notNull(),
    toKey: text('to_key').notNull(),
    sessionId: uuid('session_id').references(() => gameSessions.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => ({
    campaignEdgeUnique: uniqueIndex('story_map_revealed_edges_campaign_from_to').on(
      table.campaignId,
      table.fromKey,
      table.toKey,
    ),
  }),
);
