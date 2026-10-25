/**
 * #782 item 8: the route-side phase picker. Server-only (it reads the
 * database); the phase schemas themselves live in the runtime-neutral
 * dm-response-schema module.
 *
 * The route, server-side, before the provider call, from session state it
 * already trusts:
 *   - no live encounter for the session -> narrative (entry turns are
 *     narrative turns; the narrative schema keeps the entry fields)
 *   - live encounter + an active tactical map row -> tactical
 *   - live encounter + no active map row -> combat (Q1: YES, a live
 *     encounter can lack a seated tactical scene — run 9's documented
 *     half-transition, the non-transactional startCombat-then-seat order,
 *     and the live no_tactical_map error all prove it; combat and tactical
 *     must not collapse)
 * The picker is fail-safe: any lookup error falls back to today's full live
 * schema and logs — a picker failure must never fail or silently narrow a
 * player's turn. Phase selection is also pinned to the full schema behind
 * LLM_DM_PHASE_PICKER=off (rollback, mirroring the
 * LLM_STRICT_BRANCH_VALIDATION precedent).
 */

import {
  dmResponseSchema,
  dmResponseSchemaForPhase,
  type DmResponsePhase,
} from './dm-response-schema.js';
import { logger } from '../../lib/logger.js';

/** Pure decision core: no database, unit-testable without a session. */
export function phaseForSessionState(state: {
  hasEncounter: boolean;
  hasTacticalMap: boolean;
}): 'narrative' | 'combat' | 'tactical' {
  if (!state.hasEncounter) return 'narrative';
  return state.hasTacticalMap ? 'tactical' : 'combat';
}

export type PhasePickerDeps = {
  getActiveEncounter?: (
    sessionId: string,
    userId: string,
  ) => Promise<unknown | undefined | null>;
  loadActiveTacticalMap?: (sessionId: string) => Promise<unknown | null>;
};

export type PickedPhase = {
  phase: DmResponsePhase;
  schema: Record<string, unknown>;
  /** True when the picker fell back to the full schema (lookup error or off). */
  fallback: boolean;
};

let phasePickerEnabled =
  process.env.LLM_DM_PHASE_PICKER?.trim().toLowerCase() !== 'off';

/**
 * A lookup that never settles must not hang the turn: the design's
 * fail-safe covers lookup ERRORS, and a hung database is the same failure
 * with no error attached. CI proved it — with no DATABASE_URL the real
 * encounter lookup hangs past bun's 5s test timeout instead of throwing
 * (PR 1110 run 40160860100: 4 route-test timeouts). One budget for the
 * whole decision, so a slow encounter lookup cannot stack with a slow map
 * lookup; on expiry the existing catch falls back to the full schema.
 */
const PICKER_LOOKUP_TIMEOUT_MS = 2000;

const withLookupTimeout = async <T>(lookup: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('dm phase picker lookup timed out')),
          PICKER_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

/** Test hook: pin the picker on or off without reloading the module. */
export const setPhasePickerEnabledForTests = (enabled: boolean): void => {
  phasePickerEnabled = enabled;
};

export async function pickDmResponsePhase(
  sessionId: string | undefined | null,
  userId: string,
  deps: PhasePickerDeps = {},
): Promise<PickedPhase> {
  const full: PickedPhase = { phase: 'full', schema: dmResponseSchema, fallback: true };
  if (!phasePickerEnabled) return full;
  if (!sessionId) return { phase: 'narrative', schema: dmResponseSchemaForPhase('narrative'), fallback: false };
  try {
    return await withLookupTimeout((async () => {
      const getActiveEncounter =
        deps.getActiveEncounter ??
        (await import('../combat/combat-encounter-service.js')).CombatEncounterService
          .getActiveEncounter;
      const encounter = await getActiveEncounter(sessionId, userId);
      if (!encounter) {
        return { phase: 'narrative', schema: dmResponseSchemaForPhase('narrative'), fallback: false };
      }
      const loadActiveTacticalMap =
        deps.loadActiveTacticalMap ??
        (await import('../combat/tactical-map-store.js')).loadActiveTacticalMap;
      const map = await loadActiveTacticalMap(sessionId);
      const phase = phaseForSessionState({ hasEncounter: true, hasTacticalMap: map != null });
      return { phase, schema: dmResponseSchemaForPhase(phase), fallback: false };
    })());
  } catch (error) {
    // Fail-safe per the item-8 design: never fail or silently narrow the turn.
    logger.warn({
      msg: 'LLM_DM_PHASE_PICKER_FALLBACK',
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return full;
  }
}
