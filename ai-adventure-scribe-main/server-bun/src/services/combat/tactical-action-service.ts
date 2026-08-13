import {
  loadActiveTacticalMap,
  loadLatestTacticalMapRow,
  saveTacticalMap,
  saveTacticalMapRow,
} from './tactical-map-store.js';
import { alert } from '../../lib/alerting.js';
import { combatLogger } from '../../lib/logger.js';
import { dispatchMapAction, dispatchWithOneCorrectiveRetry } from '../../tactical/dispatch.js';
import { broadcastToRoom } from '../collaboration/room-manager.js';

import type { MapAction } from '../../tactical/dispatch.js';
import type { MapEntity } from '../../tactical/types.js';

const broadcast = (sessionId: string, payload: Record<string, unknown>): void =>
  broadcastToRoom(sessionId, null as never, { ...payload, timestamp: Date.now() });

export type TacticalDelta =
  | {
      type: 'entity_moved';
      entityId: string;
      path: { x: number; y: number }[];
      movementRemaining?: number;
      forced?: boolean;
      mode?: 'shove' | 'pull' | 'teleport';
    }
  | { type: 'entity_placed'; entity: MapEntity }
  | { type: 'entity_removed'; entityId: string }
  | { type: 'cell_updated'; x: number; y: number; changes: Record<string, unknown> };

const deltaFor = (
  action: MapAction,
  result: { path?: { x: number; y: number }[] },
  entities?: MapEntity[],
): TacticalDelta => {
  if (action.action === 'move')
    return {
      type: 'entity_moved',
      entityId: action.entityId!,
      path: result.path ?? [],
      movementRemaining: entities?.find((entity) => entity.id === action.entityId)
        ?.movementRemaining,
    };
  if (action.action === 'forced_move')
    return {
      type: 'entity_moved',
      entityId: action.target,
      path: result.path ?? [],
      forced: true,
      mode: action.mode,
    };
  if (action.action === 'update_cell')
    return {
      type: 'cell_updated',
      x: action.x!,
      y: action.y!,
      changes: (action.changes ?? {}) as Record<string, unknown>,
    };
  if (action.action === 'place')
    return { type: 'entity_placed', entity: action.changes as MapEntity };
  return { type: 'entity_removed', entityId: action.entityId! };
};

/** Common DM/player mutation path: validate with engine, persist, then publish a delta. */
export async function applyTacticalMapAction(
  sessionId: string,
  action: MapAction,
  options: { broadcast?: boolean } = {},
) {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map) return { applied: false as const, action, refusal: { reason: 'no_active_map' } };
  const result = dispatchMapAction(map, action);
  if (!result.applied) return result;
  await saveTacticalMap(map);
  if (options.broadcast !== false) broadcast(sessionId, deltaFor(action, result, map.entities));
  return result;
}

export type CorrectiveMapReprompt = (refusal: Record<string, unknown>) => Promise<MapAction | null>;

/**
 * DM actions are still ordinary engine actions. One refusal may be sent back to the
 * model with its valid-move summary; a second refusal is logged/dropped, never looped.
 */
export async function applyDmTacticalActions(
  sessionId: string,
  actions: MapAction[],
  correctiveReprompt?: CorrectiveMapReprompt,
) {
  const results = [];
  const appliedDeltas: TacticalDelta[] = [];
  const degraded: Record<string, unknown>[] = [];
  let retried = false;
  for (const action of actions) {
    const retry =
      !retried && correctiveReprompt
        ? async (refusal: Record<string, unknown>) => {
            retried = true;
            return correctiveReprompt({ action, refusal });
          }
        : undefined;
    const result = await dispatchWithOneCorrectiveRetry(
      action,
      (candidate) => applyTacticalMapAction(sessionId, candidate, { broadcast: false }),
      retry,
    );
    if (result.applied) {
      const current = await loadActiveTacticalMap(sessionId);
      appliedDeltas.push(deltaFor(result.action, result, current?.entities));
    } else {
      // An unresolvable entity means the DM and the board disagree about who exists; that is
      // the failure that silently froze an entire encounter, so it is logged at error level
      // with the roster attached rather than warned about and forgotten.
      const unknownEntity = (result.refusal as { reason?: string }).reason === 'unknown_entity';
      combatLogger[unknownEntity ? 'error' : 'warn'](
        { sessionId, action, refusal: result.refusal, alert: unknownEntity },
        unknownEntity
          ? '[tactical] DM map action named an entity that is not on the board'
          : '[tactical] dropped invalid DM map action',
      );
      if (unknownEntity) {
        // Loud, not just logged (#1680): this was previously an `alert: unknownEntity`
        // marker nobody consumed. A DM/board mismatch is exactly the kind of continuity
        // failure that otherwise looks like a normal degraded turn in prod.
        alert('tactical_unknown_entity', {
          sessionId,
          error: JSON.stringify(result.refusal),
        });
      }
      degraded.push(result.refusal);
    }
    results.push(result);
  }
  if (appliedDeltas.length)
    broadcast(sessionId, { type: 'tactical_action_queue', actions: appliedDeltas });
  if (degraded.length) {
    const line = 'A tactical effect glances off; the DM will correct the scene on its next turn.';
    const map = await loadActiveTacticalMap(sessionId);
    if (map) {
      map.pendingDmCorrection = `The prior tactical action was rejected: ${JSON.stringify(degraded)}. Acknowledge the failed effect in the fiction and do not repeat an illegal map action.`;
      await saveTacticalMap(map);
    }
    broadcast(sessionId, { type: 'tactical_degraded', text: line, reasons: degraded });
  }
  return { results, appliedDeltas, degraded };
}

/**
 * Record something the engine resolved that the DM has not been told about yet. These are
 * facts, not corrections: the DM did nothing wrong, the board simply had the final say.
 *
 * Written to the session's LATEST map row rather than its active one. A fact recorded on the
 * killing blow is written microseconds before `endCombatIfResolved` tears the board down, and
 * a channel that closes with the board is a channel that can never carry an ending. See
 * `loadLatestTacticalMapRow`.
 */
export async function recordDmTacticalFact(sessionId: string, fact: string): Promise<void> {
  // A concluded fight has no active board to receive a new engine fact. This mirrors
  // `destroyTacticalCombatMap`: post-conclusion retries must not append another victory
  // instruction to the latest, already-consumed map row.
  if (!(await loadActiveTacticalMap(sessionId))) return;
  const row = await loadLatestTacticalMapRow(sessionId);
  if (!row) return;
  row.state.pendingDmFacts = [...(row.state.pendingDmFacts ?? []), fact];
  await saveTacticalMapRow(row.rowId, row.state);
}

/**
 * Return the engine-resolved facts with the next tactical digest, then clear them.
 *
 * Reads the latest row, active or not, for the same reason the writer does: the last thing
 * that happened in a fight is recorded on a board that no longer exists by the time anyone
 * asks about it.
 */
export async function consumeDmTacticalFacts(sessionId: string): Promise<string[]> {
  const row = await loadLatestTacticalMapRow(sessionId);
  if (!row?.state.pendingDmFacts?.length) return [];
  const facts = row.state.pendingDmFacts;
  delete row.state.pendingDmFacts;
  await saveTacticalMapRow(row.rowId, row.state);
  return facts;
}

/**
 * Advances the engine-silence streak by one turn, or resets it because something resolved.
 * Returns the streak the DM context should be built against.
 *
 * Counting happens where the context is assembled rather than where actions are executed,
 * because the thing being counted is turns the DM was given nothing — and a turn the DM never
 * asked about is a turn that did not happen.
 */
export async function noteEngineResolutions(
  sessionId: string,
  resolvedSomething: boolean,
): Promise<number> {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map) return 0;
  const streak = resolvedSomething ? 0 : (map.dmSilentTurns ?? 0) + 1;
  if ((map.dmSilentTurns ?? 0) === streak) return streak;
  map.dmSilentTurns = streak;
  await saveTacticalMap(map);
  return streak;
}

/**
 * Return the one-shot correction fact with the next tactical digest, then clear it.
 *
 * Latest row, not active row: a correction recorded on the DM's last map action before the
 * fight ended has exactly the same delivery problem the facts had.
 */
export async function consumeDmTacticalCorrection(sessionId: string): Promise<string | null> {
  const row = await loadLatestTacticalMapRow(sessionId);
  if (!row?.state.pendingDmCorrection) return null;
  const correction = row.state.pendingDmCorrection;
  delete row.state.pendingDmCorrection;
  await saveTacticalMapRow(row.rowId, row.state);
  return correction;
}
