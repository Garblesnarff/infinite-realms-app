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
} from 'drizzle-orm/pg-core';

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
