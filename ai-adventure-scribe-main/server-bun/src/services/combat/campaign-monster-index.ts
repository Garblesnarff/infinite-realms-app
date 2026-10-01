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
import { monsterKeyTokens, normalizeMonsterKey } from './monster-key.js';

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

const isNpcChunk = (chunkType: string): boolean => chunkType.startsWith('npc_');

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
    if (!key) continue;
    const existing = index.byKey.get(key);
    // A bestiary entry outranks an NPC entry of the same name ("The Flavor-Elemental
    // (Corrupted)" is an NPC bio; "Flavor-Elemental (Corrupted)" is the monster).
    if (existing && (!isNpcChunk(existing.chunkType) || isNpcChunk(row.chunkType))) continue;
    const parsed = parseAuthoredStatBlock(row.content);
    const coverage = gradeCoverage(parsed);
    // An NPC bio with no block is not a stat source; keeping it would hide the SRD rung. And a
    // chunk that reads as nothing never displaces an entry that does carry a block.
    if ((isNpcChunk(row.chunkType) || existing) && coverage === 'none') continue;
    index.byKey.set(key, {
      entityName: row.entityName,
      chunkType: row.chunkType,
      parsed,
      coverage,
    });
  }

  return index;
}

/** Honorifics a seat label may lead with when the bible spells the NPC out in full. */
const NPC_TITLES = new Set([
  'captain',
  'sergeant',
  'lieutenant',
  'commander',
  'general',
  'lord',
  'lady',
  'sir',
  'dame',
  'doctor',
  'professor',
  'father',
  'mother',
  'brother',
  'sister',
  'master',
  'elder',
]);

/**
 * The one inexact match: a seat labelled "<title> <surname>" ("Captain Reeves") reaches the
 * single bible entry that starts with that title, ends with that surname and carries more
 * words between ("Captain Sarah Reeves"). Two or more such entries means the seat label does
 * not say which NPC is meant, so nothing is returned and the caller keeps its fallback.
 */
const findTitledPartialMatch = (
  index: CampaignMonsterIndex,
  name: string,
): AuthoredMonster | null => {
  const seat = monsterKeyTokens(name);
  if (seat.length < 2 || !NPC_TITLES.has(seat[0]!)) return null;

  const matches: AuthoredMonster[] = [];
  for (const entry of index.byKey.values()) {
    const tokens = monsterKeyTokens(entry.entityName);
    if (tokens.length <= seat.length) continue;
    if (tokens[0] !== seat[0] || tokens[tokens.length - 1] !== seat[seat.length - 1]) continue;
    let next = 1;
    for (const token of tokens) if (token === seat[next]) next += 1;
    if (next >= seat.length) matches.push(entry);
  }
  return matches.length === 1 ? matches[0]! : null;
};

/**
 * Matches a combatant against the campaign's authored creatures.
 *
 * Both the DM's `monster_id` and the combatant's display name are tried, each normalized by
 * the shared rule, so "Gluten Golem", "gluten_golem", "gluten-golem" and "GLUTEN GOLEM" all
 * reach the same chunk. Beyond that, the only inexact match is a titled name against the one
 * bible entry it abbreviates (`findTitledPartialMatch`). There is deliberately no other fuzzy
 * matching against authored names, because a bible's creatures are the author's canon and
 * guessing between two of them would hand one creature's numbers to another.
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
  return name ? findTitledPartialMatch(index, name) : null;
}
