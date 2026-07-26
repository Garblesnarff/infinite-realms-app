/**
 * The in-memory shape of a campaign's authored creatures, and how a combatant is matched
 * against it.
 *
 * Deliberately free of any database import. The matching rule is pure, so the stat ladder
 * that consumes it stays unit-testable without a Postgres connection, and the loader in
 * `campaign-monster-resolution.ts` is the only thing that has to know a table exists.
 */
import {
  gradeCoverage,
  parseAuthoredStatBlock,
  type ParseCoverage,
  type ParsedStatBlock,
} from './authored-stat-block-parser.js';
import { normalizeMonsterKey } from './monster-key.js';

export interface AuthoredMonster {
  entityName: string;
  chunkType: string;
  parsed: ParsedStatBlock;
  coverage: ParseCoverage;
}

export interface CampaignMonsterIndex {
  campaignId: string;
  /** Normalized entity name -> authored monster. */
  byKey: Map<string, AuthoredMonster>;
  /** Chunk count before parsing, so "campaign has no authored monsters" stays distinguishable. */
  chunkCount: number;
}

export interface StatBearingChunk {
  entityName: string | null;
  chunkType: string;
  content: string;
}

export const emptyCampaignMonsterIndex = (campaignId: string): CampaignMonsterIndex => ({
  campaignId,
  byKey: new Map(),
  chunkCount: 0,
});

/** Parses every chunk once, at load time, so combat start never parses markdown per combatant. */
export function buildCampaignMonsterIndex(
  campaignId: string,
  rows: StatBearingChunk[],
): CampaignMonsterIndex {
  const index = emptyCampaignMonsterIndex(campaignId);
  index.chunkCount = rows.length;

  for (const row of rows) {
    if (!row.entityName) continue;
    const key = normalizeMonsterKey(row.entityName);
    if (!key || index.byKey.has(key)) continue;
    const parsed = parseAuthoredStatBlock(row.content);
    index.byKey.set(key, {
      entityName: row.entityName,
      chunkType: row.chunkType,
      parsed,
      coverage: gradeCoverage(parsed),
    });
  }

  return index;
}

/**
 * Matches a combatant against the campaign's authored creatures.
 *
 * Both the DM's `monster_id` and the combatant's display name are tried, each normalized by
 * the shared rule, so "Gluten Golem", "gluten_golem", "gluten-golem" and "GLUTEN GOLEM" all
 * reach the same chunk. Matching is exact-after-normalization only — there is deliberately
 * no fuzzy matching against authored names, because a bible's creatures are the author's
 * canon and guessing between two of them would hand one creature's numbers to another.
 */
export function findAuthoredMonster(
  index: CampaignMonsterIndex,
  monsterId?: string | null,
  name?: string | null,
): AuthoredMonster | null {
  for (const candidate of [monsterId, name]) {
    if (!candidate) continue;
    const hit = index.byKey.get(normalizeMonsterKey(candidate));
    if (hit) return hit;
  }
  return null;
}
