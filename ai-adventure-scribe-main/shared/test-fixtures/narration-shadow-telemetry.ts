/**
 * #468 shadow count: the exact body `reportNarrationShadowHit` posts. The client test asserts the
 * client sends this; the server test posts it through the real route (AGENTS.md §4).
 */
export const NARRATED_DEATH_SHADOW_REPORT_BODY = {
  kind: 'narrated_death_without_engine',
  sessionId: 'sess-468-fixture',
  error: 'you_die',
  message: 'you_die',
} as const;

/** #610 shadow count: the exact body the failed-check report posts (same contract as above). */
export const FAILED_CHECK_SHADOW_REPORT_BODY = {
  kind: 'failed_check_harm_without_engine',
  sessionId: 'sess-610-fixture',
  error: 'rope_burn',
  message: 'rope_burn',
} as const;
