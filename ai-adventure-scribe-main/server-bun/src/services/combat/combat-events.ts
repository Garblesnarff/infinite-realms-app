import { logger } from '../../lib/logger.js';

export type CombatAnalyticsEvent =
  | 'combat_started'
  | 'initiative_completed'
  | 'action_accepted'
  | 'action_refused'
  | 'damage_applied'
  | 'combat_ended'
  | 'abandonment'
  | 'dm_latency'
  // #1779: the deterministic entry gate decided to seat an encounter and could not.
  | 'combat_entry_failed'
  // #1779 §3: the DM moved the board while no encounter existed. This used to be a
  // `no_active_map` refusal logged as a routine dropped action — the engine knew the model
  // was fighting and told no one.
  | 'tactical_action_without_encounter';

/** Structured server analytics; mechanics never depend on analytics delivery. */
export function trackCombatEvent(
  event: CombatAnalyticsEvent,
  properties: Record<string, unknown>,
): void {
  logger.info({ event, category: 'combat_integrity', ...properties });
}
