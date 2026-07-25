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
const byId = new Map(catalog.map((entry) => [entry.id.toLowerCase(), entry]));
const byName = new Map(catalog.map((entry) => [entry.name.toLowerCase(), entry]));

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

export function findSrdMonster(monsterId?: string | null, name?: string | null): CatalogEntry | null {
  const id = monsterId?.trim().toLowerCase();
  if (id) {
    const direct = byId.get(id) ?? byId.get(id.startsWith('srd:') ? id : `srd:${id}`);
    if (direct) return direct;
  }
  const label = name?.trim().toLowerCase();
  return (label && byName.get(label)) || null;
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
): ResolvedMonsterStats | null {
  const entry = findSrdMonster(monsterId, name);

  if (!entry) {
    if (monsterId) {
      logger.warn({
        msg: 'Unresolved SRD monster id on combat start; falling back to generic NPC stats',
        monsterId,
        combatantName: name,
        ...context,
      });
    }
    return null;
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
