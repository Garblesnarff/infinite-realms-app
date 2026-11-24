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

/** #1595 shadow count: the body the dead-NPC report posts (pattern names only, no text). */
export const NARRATED_DEAD_NPC_SHADOW_REPORT_BODY = {
  kind: 'narrated_dead_npc_acting',
  sessionId: 'sess-1595-fixture',
  error: 'attack,return_or_entry',
  message: 'attack,return_or_entry',
} as const;

/** #610 shadow count: the exact body the failed-check report posts (same contract as above). */
export const FAILED_CHECK_SHADOW_REPORT_BODY = {
  kind: 'failed_check_harm_without_engine',
  sessionId: 'sess-610-fixture',
  error: 'rope_burn',
  message: 'rope_burn',
} as const;

/** #1704 shadow count: the exact body the confrontation-without-combat-entry report posts. */
export const CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REPORT_BODY = {
  kind: 'confrontation_without_combat_entry',
  sessionId: 'sess-1704-fixture',
  error: 'rushes,squares_up',
  message: 'rushes,squares_up',
} as const;

export const NARRATED_ENEMY_HP_REPORT_BODY = {
  kind: 'narrated_enemy_hp_number',
  sessionId: 'sess-1722-fixture',
  error: 'down_to_hp,hp_left',
  message: 'down_to_hp,hp_left',
  route: '/',
  bundle: 'dev',
  clientTimestamp: '2026-11-24T02:00:00.000Z',
} as const;
