/**
 * Resistance Resolver Module
 *
 * Extracts and deduplicates the resistance/vulnerability/immunity
 * aggregation logic that was repeated across resolveAttack and
 * resolveSpellAttack.
 *
 * Pure function - no database access.
 *
 * @module server/services/combat/resistance-resolver
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CreatureStats } from '../../../../db/schema/index.js';
import type { DamageType } from '../../types/combat.js';

/**
 * Aggregated resistance information for a target
 */
export interface AggregatedDefenses {
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
}

/**
 * Aggregate resistances, vulnerabilities, and immunities for a combat target.
 *
 * Prioritizes participant-level modifications (e.g., from spells or effects)
 * but falls back to base creature stats if no participant-level overrides exist.
 *
 * This logic was duplicated in resolveAttack and resolveSpellAttack.
 *
 * @param participant - The combat participant (with damageResistances, damageVulnerabilities, damageImmunities)
 * @param stats - The base creature stats (with resistances, vulnerabilities, immunities), or null
 * @returns Aggregated defenses for use in damage calculation
 */
export function aggregateResistances(
  participant: any,
  stats: CreatureStats | null,
): AggregatedDefenses {
  const resistances = (
    participant.damageResistances?.length ? participant.damageResistances : stats?.resistances || []
  ) as DamageType[];
  const vulnerabilities = (
    participant.damageVulnerabilities?.length
      ? participant.damageVulnerabilities
      : stats?.vulnerabilities || []
  ) as DamageType[];
  const immunities = (
    participant.damageImmunities?.length ? participant.damageImmunities : stats?.immunities || []
  ) as DamageType[];

  return { resistances, vulnerabilities, immunities };
}
