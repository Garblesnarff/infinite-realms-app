/**
 * Loads campaign-authored monster stats — the top rung of the combat stat ladder.
 *
 * The product is 163 pre-written campaign bibles with original creatures and authored stat
 * blocks. Nothing in combat had ever read them: `grep` found zero references to
 * `campaign_chunks` anywhere in server-bun/src. So the Gluten Golem's authored 90 HP fought
 * at 11, the Shadow Roach's 20 fought at 11, and fifteen playtest runs ended every fight in
 * one or two exchanges.
 *
 * This module owns only the query and the cache. Parsing lives in
 * `authored-stat-block-parser`; matching lives in `campaign-monster-index`.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';

import {
  buildCampaignMonsterIndex,
  emptyCampaignMonsterIndex,
  type CampaignMonsterIndex,
} from './campaign-monster-index.js';
import { db } from '../../../../db/client';
import { campaignChunks } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

/**
 * Chunk types that can carry a stat block.
 *
 * `encounter` is included because some bibles stat creatures inside encounter entries.
 * `npc_tier1..3` are included because a bible can give a combat-capable NPC an `*HP:* /
 * *AC:* / *Attack:*` block under its NPC entry (Captain Sarah Reeves, #2398). Most NPC
 * entries are narrative bios (Voice/Goal/Secret) with no numbers; `buildCampaignMonsterIndex`
 * drops an NPC chunk that parses to nothing, so those never shadow an SRD creature of the
 * same name ("Goblin", "Dragon" are tier-2 minor NPCs in the Academy bible).
 */
export const STAT_BEARING_CHUNK_TYPES = [
  'monster',
  'encounter',
  'npc_tier1',
  'npc_tier2',
  'npc_tier3',
] as const;

/**
 * Performance: one indexed query per campaign per process, memoized.
 *
 * Starter campaigns are documented read-only canon ("Users cannot modify this content"),
 * and a bible carries ~10-30 stat-bearing chunks, so a campaign's whole index is a few
 * kilobytes fetched behind the existing `idx_campaign_chunks_type` index on
 * (campaign_id, chunk_type). Combat start therefore pays at most ONE extra query, and every
 * combatant in that encounter resolves against the in-memory index — never one query per
 * monster. Markdown is parsed once at load, not once per combatant.
 *
 * A TTL bounds staleness after a re-ingest without needing a server restart; a miss costs
 * one indexed read, so it is cheap to keep short.
 *
 * Deliberately NOT parse-at-ingest into a new table: that needs a migration, migrations do
 * not auto-apply on this deploy, and it would freeze the parser's output where the audit
 * script could no longer re-grade all 163 bibles as the parser improves.
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { index: CampaignMonsterIndex; loadedAt: number }>();

/** Drops all cached indexes. Exported for tests and for post-ingest invalidation. */
export function clearCampaignMonsterCache(): void {
  cache.clear();
}

/**
 * Loads and parses every stat-bearing chunk for a campaign.
 *
 * Never throws. A database failure here must not take down combat start — that would turn a
 * stat-quality improvement into an availability regression. A failed load logs and yields an
 * empty index, so resolution falls through to the SRD rung exactly as it did before authored
 * stats were read at all.
 */
export async function loadCampaignMonsterIndex(
  campaignId: string | null | undefined,
): Promise<CampaignMonsterIndex> {
  if (!campaignId) return emptyCampaignMonsterIndex('');

  const cached = cache.get(campaignId);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) return cached.index;

  try {
    const rows = await db
      .select({
        entityName: campaignChunks.entityName,
        chunkType: campaignChunks.chunkType,
        content: campaignChunks.content,
      })
      .from(campaignChunks)
      .where(
        and(
          eq(campaignChunks.campaignId, campaignId),
          inArray(campaignChunks.chunkType, [...STAT_BEARING_CHUNK_TYPES]),
          isNotNull(campaignChunks.entityName),
        ),
      );

    const index = buildCampaignMonsterIndex(campaignId, rows);
    cache.set(campaignId, { index, loadedAt: Date.now() });
    return index;
  } catch (error) {
    logger.error({
      msg: 'Failed to load campaign monster stat blocks; combat will fall back to SRD stats',
      campaignId,
      error,
    });
    return emptyCampaignMonsterIndex(campaignId);
  }
}

export { findAuthoredMonster, type CampaignMonsterIndex } from './campaign-monster-index.js';
