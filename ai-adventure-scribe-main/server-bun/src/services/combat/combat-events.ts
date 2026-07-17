import { logger } from '../../lib/logger.js';

export type CombatAnalyticsEvent =
  | 'combat_started'
  | 'initiative_completed'
  | 'action_accepted'
  | 'action_refused'
  | 'damage_applied'
  | 'combat_ended'
  | 'abandonment'
  | 'dm_latency';

/** Structured server analytics; mechanics never depend on analytics delivery. */
export function trackCombatEvent(
  event: CombatAnalyticsEvent,
  properties: Record<string, unknown>,
): void {
  logger.info({ event, category: 'combat_integrity', ...properties });
}
