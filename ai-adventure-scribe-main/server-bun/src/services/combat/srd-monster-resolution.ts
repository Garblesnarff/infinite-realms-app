import { monsterKeyTokens, normalizeMonsterKey } from './monster-key.js';
import monsterCatalog from '../../../../src/data/srd/monsters.json' with { type: 'json' };
import { logger } from '../../lib/logger.js';

import type { EntitySize } from '../../tactical/types.js';

/**
 * Structured DM combat starts name their enemies freely ("Aggressive Patron") while
 * identifying the stat block separately (`monster_id: "srd:bandit"`). Resolving that id
 * server-side is what turns a combatant into a real creature instead of a 10/10/30
 * placeholder. The id is a *catalog lookup key only* — never a database key — so a
 * hallucinated value can never become a foreign key.
 */
type CatalogEntry = {
  id: string;
  name: string;
  size?: string;
  armorClass?: number;
  hitPoints?: number;
  speed?: Record<string, string>;
  abilities?: Record<string, number>;
  resistances?: string[];
  immunities?: string[];
  vulnerabilities?: string[];
};

export interface ResolvedMonsterStats {
  monsterId: string;
  monsterName: string;
  size: EntitySize;
  armorClass: number;
  maxHp: number;
  speed: number;
  initiativeModifier: number;
  damageResistances: string[];
  damageImmunities: string[];
  damageVulnerabilities: string[];
}

/** Stat line used when no SRD id was supplied — a deliberate generic NPC, not a lie. */
export const GENERIC_NPC_STATS = {
  size: 'medium' as EntitySize,
  armorClass: 12,
  maxHp: 11,
  speed: 30,
  initiativeModifier: 0,
} as const;

const TACTICAL_SIZES = new Set<EntitySize>([
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
]);

// The JSON's inferred literal type is a union of per-entry shapes (optional speed keys
// differ per monster), so it needs the `unknown` hop to widen to the read model above.
const catalog = monsterCatalog as unknown as CatalogEntry[];

/**
 * Catalog keys and incoming ids both go through `normalizeMonsterKey`, so the two can never
 * drift. Playtest run 15: the DM sent `srd:stone_golem` and the catalog holds
 * `srd:stone-golem`, so a CR 10 creature missed its own entry by one character and fought
 * as an 11 HP generic NPC -- a 16x HP swing. Verified collision-free: all 334 catalog ids
 * and all 334 catalog names remain distinct after normalization.
 */
const normalizeKey = normalizeMonsterKey;

const tokenize = monsterKeyTokens;

const byId = new Map(catalog.map((entry) => [normalizeKey(entry.id), entry]));
const byName = new Map(catalog.map((entry) => [normalizeKey(entry.name), entry]));

/** Token sets for near-miss matching, precomputed once alongside the exact-match maps. */
const tokenIndex = catalog.map((entry) => ({
  entry,
  tokenSets: [tokenize(entry.name), tokenize(entry.id)],
}));

/**
 * Last-resort match for a *supplied* monster id that failed exact lookup. A supplied id
 * means the model was trying to name a real creature, which is a different situation from
 * no id at all.
 *
 * Rule — an entry matches only when ALL of these hold:
 *   1. Every token of the catalog entry's name (or id) appears in the query's token set.
 *   2. That catalog token set has at least two tokens.
 *   3. The query carries at most one token beyond the entry's own tokens.
 *   4. Exactly one catalog entry satisfies 1-3; any ambiguity resolves to no match.
 *
 * It cannot produce a wrong creature because a match requires the query to *contain the
 * entry's complete name*, not merely overlap it. `gluten-golem-01` does not match
 * `stone-golem` (no `stone`), `clay-golem` (no `clay`), or a bare `golem` (rule 2 bars
 * single-token entries, so common nouns like `golem`, `zombie` or `giant` can never carry
 * a match on their own). `the-void-maw` and `doorkeeper` match nothing, as they should —
 * they are homebrew. What it does catch: `ancient-red-dragon-boss` → `srd:ancient-red-dragon`,
 * `srd:dire_wolf_alpha` → `srd:dire-wolf`. Rule 3 keeps a long narrative title from
 * dragging in a short SRD name, and rule 4 means a near-miss is never a coin flip.
 */
const findNearMissEntry = (monsterId: string): CatalogEntry | null => {
  const queryTokens = new Set(tokenize(monsterId));
  if (queryTokens.size === 0) return null;

  const matches = tokenIndex.filter(({ tokenSets }) =>
    tokenSets.some((tokens) => {
      const unique = new Set(tokens);
      return (
        unique.size >= 2 &&
        tokens.every((token) => queryTokens.has(token)) &&
        queryTokens.size - unique.size <= 1
      );
    }),
  );

  return matches.length === 1 ? matches[0]!.entry : null;
};

const abilityModifier = (score: number): number => Math.floor((score - 10) / 2);

/** SRD speeds are display strings ("30 ft.", "40 ft. swim"); combat needs the number. */
const walkSpeedFeet = (speed: Record<string, string> | undefined): number => {
  const match = /(\d+)/.exec(speed?.walk ?? '');
  return match ? Number(match[1]) : GENERIC_NPC_STATS.speed;
};

const tacticalSize = (size: string | undefined): EntitySize => {
  const normalized = size?.toLowerCase();
  return normalized && TACTICAL_SIZES.has(normalized as EntitySize)
    ? (normalized as EntitySize)
    : GENERIC_NPC_STATS.size;
};

type CatalogMatch = {
  entry: CatalogEntry;
  /** How the entry was found — 'near-miss' is logged, since it is an inference. */
  matchType: 'id' | 'name' | 'near-miss';
};

function matchSrdMonster(monsterId?: string | null, name?: string | null): CatalogMatch | null {
  const id = monsterId ? normalizeKey(monsterId) : '';
  if (id) {
    const direct = byId.get(id) ?? byName.get(id);
    if (direct) return { entry: direct, matchType: 'id' };
  }

  const label = name ? normalizeKey(name) : '';
  if (label) {
    const byLabel = byName.get(label) ?? byId.get(label);
    if (byLabel) return { entry: byLabel, matchType: 'name' };
  }

  // Only a *supplied* id earns a near-miss attempt; a bare narrative name is not evidence
  // that the model meant an SRD creature at all.
  if (id) {
    const near = findNearMissEntry(id);
    if (near) return { entry: near, matchType: 'near-miss' };
  }

  return null;
}

export function findSrdMonster(
  monsterId?: string | null,
  name?: string | null,
): CatalogEntry | null {
  return matchSrdMonster(monsterId, name)?.entry ?? null;
}

/**
 * Resolves an SRD stat block for a combatant.
 *
 * Returns `null` when nothing matched. When a `monsterId` *was* supplied but did not
 * resolve, the miss is logged at warn level: the caller still falls back to a generic
 * NPC, but the fallback is never silent.
 */
export function resolveSrdMonsterStats(
  monsterId?: string | null,
  name?: string | null,
  context: Record<string, unknown> = {},
  options: { suppressFallbackWarn?: boolean } = {},
): ResolvedMonsterStats | null {
  const match = matchSrdMonster(monsterId, name);

  if (!match) {
    if (monsterId && !options.suppressFallbackWarn) {
      // The old warn named only the cause ("unresolved id"), which reads as a lookup miss.
      // The consequence is what matters in play: a creature the DM chose deliberately is
      // now AC 12 / 11 HP. Say so, so the log shows a boss was downgraded.
      logger.warn({
        msg: 'Unresolved SRD monster id on combat start; falling back to generic NPC stats',
        monsterId,
        combatantName: name,
        armorClass: GENERIC_NPC_STATS.armorClass,
        maxHp: GENERIC_NPC_STATS.maxHp,
        consequence: `combatant fights at generic NPC stats (AC ${GENERIC_NPC_STATS.armorClass}, ${GENERIC_NPC_STATS.maxHp} HP)`,
        ...context,
      });
    }
    return null;
  }

  const entry = match.entry;

  if (match.matchType === 'near-miss') {
    logger.info({
      msg: 'Resolved SRD monster id by near-miss match; supplied id was not an exact catalog key',
      monsterId,
      combatantName: name,
      resolvedId: entry.id,
      resolvedName: entry.name,
      ...context,
    });
  }

  const dexterity = Number(entry.abilities?.dexterity ?? 10);
  return {
    monsterId: entry.id,
    monsterName: entry.name,
    size: tacticalSize(entry.size),
    armorClass: Number(entry.armorClass ?? GENERIC_NPC_STATS.armorClass),
    maxHp: Math.max(1, Number(entry.hitPoints ?? GENERIC_NPC_STATS.maxHp)),
    speed: walkSpeedFeet(entry.speed),
    initiativeModifier: abilityModifier(Number.isFinite(dexterity) ? dexterity : 10),
    damageResistances: entry.resistances ?? [],
    damageImmunities: entry.immunities ?? [],
    damageVulnerabilities: entry.vulnerabilities ?? [],
  };
}
