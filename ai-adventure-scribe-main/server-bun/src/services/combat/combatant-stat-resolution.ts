/**
 * The combat stat ladder.
 *
 *   campaign_chunks (authored bible stats, scoped to this campaign)
 *     -> SRD catalog (monsters.json)
 *       -> GENERIC_NPC_STATS
 *
 * Campaign-first is deliberate. If a bible authors its own "Goblin" with its own numbers,
 * the author's intent outranks the generic SRD entry — the bibles are the product.
 *
 * Every rung down is logged distinctly. A stat downgrade is invisible in play: the creature
 * simply dies in one hit and the fight reads as anticlimax rather than as a bug. The log is
 * the only place it can be seen, so the generic rung states the resulting AC and HP rather
 * than merely reporting that a lookup missed.
 */
import { findAuthoredMonster, type CampaignMonsterIndex } from './campaign-monster-index.js';
import {
  resolveMonsterAttackProfile,
  type MonsterAttackProfile,
} from './monster-attack-profile.js';
import { normalizeMonsterKey } from './monster-key.js';
import {
  GENERIC_NPC_STATS,
  resolveSrdMonsterStats,
  type ResolvedMonsterStats,
} from './srd-monster-resolution.js';
import { logger } from '../../lib/logger.js';

import type { EntitySize } from '../../tactical/types.js';

/** Where each resolution landed, for logging and for tests to assert on. */
export type StatSource = 'campaign' | 'srd' | 'generic';

export interface ResolvedCombatantStats extends ResolvedMonsterStats {
  source: StatSource;
  /** Authored fields that were missing and had to be filled from a lower rung. */
  filledFromFallback: string[];
  /**
   * What this creature swings with, and which rung supplied it.
   *
   * Resolved on its own ladder — authored -> catalog -> derived — because the rung that gave
   * a creature its HP is often not the rung that can give it an attack. Every campaign bible
   * in the product today authors HP and AC and describes its creature's abilities as prose,
   * so `source: 'campaign'` stats routinely pair with `attackProfile.source: 'derived'`.
   * Flattening the two into one label would report an authored attack that nobody wrote.
   */
  attackProfile: MonsterAttackProfile;
}

const TACTICAL_SIZES = new Set<EntitySize>([
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
]);

const asTacticalSize = (size: string | undefined): EntitySize | undefined =>
  size && TACTICAL_SIZES.has(size as EntitySize) ? (size as EntitySize) : undefined;

/**
 * Resolves one combatant's stats against the ladder.
 *
 * Returns `null` only for the generic rung, matching the caller's existing
 * `monster ?? GENERIC_NPC_STATS` contract, so the fallback behaviour that is correct for
 * DM-improvised combatants ("Doorkeeper", "Hostile Patron") survives untouched.
 */
export function resolveCombatantStats(
  campaignIndex: CampaignMonsterIndex,
  monsterId?: string | null,
  name?: string | null,
  context: Record<string, unknown> = {},
): ResolvedCombatantStats | null {
  const authored = findAuthoredMonster(campaignIndex, monsterId, name);

  // The SRD entry is resolved regardless, because it is both the next rung down AND the
  // source that fills gaps in a partially-authored block. Its own fallback warn is
  // suppressed because an SRD miss is not yet a downgrade here -- the campaign rung may
  // still have supplied real numbers, and the true bottom-of-ladder warn is issued below
  // with the campaign context attached. Its near-miss log is NOT suppressed: that one
  // records an inference, which is worth seeing wherever it happens.
  const srd = resolveSrdMonsterStats(monsterId, name, context, { suppressFallbackWarn: true });

  if (authored) {
    const { parsed, coverage } = authored;

    if (coverage === 'none') {
      // The chunk exists — an author wrote this creature — but nothing in it was readable.
      // That is a content bug with a name attached, which is the whole point of logging it.
      logger.warn({
        msg: 'Campaign monster chunk found but no stats could be parsed; falling through to SRD',
        campaignId: campaignIndex.campaignId,
        entityName: authored.entityName,
        chunkType: authored.chunkType,
        unparsedLabels: parsed.unparsedLabels,
        monsterId,
        combatantName: name,
        ...context,
      });
    } else {
      const filledFromFallback: string[] = [];
      /**
       * `report: false` for fields whose absence is unremarkable. Almost no bible authors a
       * size or an initiative modifier, so reporting those would fire the partial-stats log
       * for essentially every campaign creature and bury the cases that matter — a boss with
       * no authored AC, or no authored HP.
       */
      const fill = <T>(
        authoredValue: T | undefined,
        fallback: T,
        field: string,
        report = true,
      ): T => {
        if (authoredValue !== undefined) return authoredValue;
        if (report) filledFromFallback.push(field);
        return fallback;
      };

      // Settled before the literal because the derived attack rung reads it: a creature's
      // final HP is the evidence the derivation runs on, and for a partially-authored block
      // that may be a number filled from the SRD rather than the one the bible wrote.
      const maxHp = fill(parsed.maxHp, srd?.maxHp ?? GENERIC_NPC_STATS.maxHp, 'maxHp');

      const stats: ResolvedCombatantStats = {
        source: 'campaign',
        monsterId: monsterId?.trim() || authored.entityName,
        monsterName: authored.entityName,
        maxHp,
        armorClass: fill(
          parsed.armorClass,
          srd?.armorClass ?? GENERIC_NPC_STATS.armorClass,
          'armorClass',
        ),
        speed: fill(parsed.speed, srd?.speed ?? GENERIC_NPC_STATS.speed, 'speed'),
        size: fill(asTacticalSize(parsed.size), srd?.size ?? GENERIC_NPC_STATS.size, 'size', false),
        initiativeModifier: fill(
          parsed.initiativeModifier,
          srd?.initiativeModifier ?? GENERIC_NPC_STATS.initiativeModifier,
          'initiativeModifier',
          false,
        ),
        damageResistances: parsed.damageResistances ?? srd?.damageResistances ?? [],
        damageImmunities: parsed.damageImmunities ?? srd?.damageImmunities ?? [],
        damageVulnerabilities: parsed.damageVulnerabilities ?? srd?.damageVulnerabilities ?? [],
        attacks: srd?.attacks ?? { attacks: [], unsupported: [] },
        filledFromFallback,
        attackProfile: resolveMonsterAttackProfile({
          authored: parsed,
          catalog: srd?.attacks ?? null,
          maxHp,
          monsterName: authored.entityName,
        }),
      };

      if (filledFromFallback.length > 0) {
        logger.info({
          msg: 'Campaign monster resolved with partially authored stats; missing fields filled from fallback',
          campaignId: campaignIndex.campaignId,
          entityName: authored.entityName,
          parsedFields: parsed.parsedFields,
          unparsedLabels: parsed.unparsedLabels,
          filledFromFallback,
          filledFrom: srd ? 'srd' : 'generic',
          armorClass: stats.armorClass,
          maxHp: stats.maxHp,
          ...context,
        });
      }

      return stats;
    }
  } else if (campaignIndex.chunkCount > 0 && (monsterId || name)) {
    // The campaign HAS authored creatures, this combatant just is not one of them. Usually
    // correct (DM improvisation), but it is also how a name drift between the bible and the
    // DM's output would present, so it is recorded rather than assumed.
    logger.debug({
      msg: 'No campaign-authored stat block for combatant; falling through to SRD',
      campaignId: campaignIndex.campaignId,
      monsterId,
      combatantName: name,
      authoredCreatureCount: campaignIndex.chunkCount,
      ...context,
    });
  }

  if (srd) {
    // A catalog creature normally has its own printed actions. The ten entries that do not
    // (Multiattack-only or purely save-based action lists) fall to the derived rung here
    // rather than to the generic default, which is why the derivation is offered its HP.
    return {
      ...srd,
      source: 'srd',
      filledFromFallback: [],
      attackProfile: resolveMonsterAttackProfile({
        catalog: srd.attacks,
        maxHp: srd.maxHp,
        monsterName: srd.monsterName,
      }),
    };
  }

  // The bottom of the ladder. Name the consequence, not just the cause: a reader must be
  // able to see that a boss was downgraded, not merely that a lookup missed.
  //
  // No longer gated on `monsterId` (#1858). The gate assumed that a combatant with only a
  // narrative name was never meant to be a real creature, so its downgrade was not worth
  // reporting — but the Brigade Warriors arrived name-only, fought at verbatim
  // GENERIC_NPC_STATS (AC 12 / 11 HP) with a NULL attack profile, and nothing in the log
  // said so. Landing on the generic rung is worth a line however the combatant got here.
  // Logging only: the `null` return, and every caller's behaviour, is unchanged.
  logger.warn({
    msg: 'Unresolved monster on combat start; falling back to generic NPC stats',
    campaignId: campaignIndex.campaignId || null,
    monsterId,
    combatantName: name,
    armorClass: GENERIC_NPC_STATS.armorClass,
    maxHp: GENERIC_NPC_STATS.maxHp,
    consequence: `combatant fights at generic NPC stats (AC ${GENERIC_NPC_STATS.armorClass}, ${GENERIC_NPC_STATS.maxHp} HP)`,
    ...context,
  });

  return null;
}

const DUPLICATE_SUFFIX = /\s+\d+$/;

/**
 * The name a seated combatant carries.
 *
 * A DM can declare its own label for a creature it seats by `monsterId` ("Corrupted Shard")
 * while the bible entry, the bestiary button and the art link all read "Flavor-Elemental
 * (Corrupted)" (#2398, M9 #2372). A campaign-authored creature takes the bible's heading, so
 * the engine lines, the tracker and the bestiary agree. A declared name that already matches
 * the heading keeps its spelling and its duplicate number ("Shadow Roach 2"); a renamed one
 * keeps the number too. Only the campaign rung renames: an SRD near-miss is an inference, and
 * renaming on an inference would put a wrong name on the tracker.
 */
export function bestiaryDisplayName(
  declaredName: string,
  monster: ResolvedCombatantStats | null,
): string {
  if (monster?.source !== 'campaign') return declaredName;
  const base = declaredName.replace(DUPLICATE_SUFFIX, '');
  if (normalizeMonsterKey(base) === normalizeMonsterKey(monster.monsterName)) return declaredName;
  return `${monster.monsterName}${declaredName.match(DUPLICATE_SUFFIX)?.[0] ?? ''}`;
}

/**
 * Writes the display name onto each campaign-creature seat's stored profile.
 *
 * Seats are grouped by the heading players would read, including seats whose DM label already
 * equals it: an un-renamed "Flavor-Elemental (Corrupted)" and a renamed "Corrupted Shard" show
 * the same text, so a group of two is numbered "... 1" and "... 2" and stays distinguishable.
 * A lone seat whose heading equals its own name needs no display name.
 */
export function assignBestiaryDisplayNames<
  T extends {
    name: string;
    bestiaryName: string | null;
    monsterAttack: MonsterAttackProfile | null;
  },
>(seats: T[]): void {
  const groups = new Map<string, T[]>();
  for (const seat of seats) {
    if (!seat.bestiaryName || !seat.monsterAttack) continue;
    groups.set(seat.bestiaryName, [...(groups.get(seat.bestiaryName) ?? []), seat]);
  }
  for (const [heading, group] of groups) {
    group.forEach((seat, index) => {
      const displayName = group.length > 1 ? `${heading} ${index + 1}` : heading;
      if (displayName === seat.name) return;
      seat.monsterAttack = { ...seat.monsterAttack!, displayName };
    });
  }
}
