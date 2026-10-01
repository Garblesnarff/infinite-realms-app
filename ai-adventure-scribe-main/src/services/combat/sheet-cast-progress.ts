import { useSyncExternalStore } from 'react';

import type { EngineResultCard } from '@/services/combat/engine-result-card';

import {
  cancelPendingSpellTargetSave,
  requestSpellTargetSave,
  type SpellTargetSaveAnswer,
  type SpellTargetSaveSpec,
} from '@/services/combat/spell-target-save-bridge';

/**
 * Where a cast pressed on the character sheet is (#2418).
 *
 * - `dm`: sent; the DM is reading the scene. Nothing has reached the engine, so nothing is spent.
 * - `save`: the target-saves card waits for the player.
 * - `roll`: the player's own spell-attack die waits for them.
 * - `resolving`: the engine holds the cast. The spell slot is spent at this point and nothing here
 *   can give it back, so a cast in this phase is not cancellable.
 * - `done`: the engine's card is in the feed; the dock shows it in short form until dismissed.
 *
 * The slot is spent only when the client commits the cast to the engine (`resolveSpell` in
 * `combat-attack-service.ts`), after the DM's reply. The save card and the engine's proposal
 * (`proposeSpellAttack`) spend nothing, so a cancel before `beginSheetCastCommit` leaves the
 * encounter exactly as it was and the "refund" is that the slot was never taken.
 */
export type SheetCastPhase = 'dm' | 'save' | 'roll' | 'resolving' | 'done';

export interface SheetCastProgress {
  spellName: string;
  phase: SheetCastPhase;
  /** Epoch ms at which `phase` began; the dock's elapsed time counts from here. */
  phaseStartedAt: number;
  /** The creature the engine rolls for, in the words the player sees. */
  targetName?: string;
  /** The player has answered the target-saves card for this cast. */
  savePassed?: boolean;
  /** False once the engine holds the cast. */
  cancellable: boolean;
  /** The player's own spell cards, once the engine has answered: one per target of an area cast. */
  results?: EngineResultCard[];
}

interface Snapshot {
  cast: SheetCastProgress | null;
}

let snapshot: Snapshot = { cast: null };
let controller: AbortController | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getSheetCastSnapshot = (): Snapshot => snapshot;

export function useSheetCastProgress(): Snapshot {
  return useSyncExternalStore(subscribe, getSheetCastSnapshot, getSheetCastSnapshot);
}

/**
 * A new sheet cast starts in `dm`, with a signal the DM call listens to. Returns false while another
 * cast is in flight (the sheet is mounted in more than one place): that click is ignored, so one
 * cast never aborts or clears another. Only the caller that got true may call `finishSheetCast`.
 */
export function beginSheetCast(spellName: string): boolean {
  if (snapshot.cast && snapshot.cast.phase !== 'done') return false;
  controller = new AbortController();
  publish({
    cast: { spellName, phase: 'dm', phaseStartedAt: Date.now(), cancellable: true },
  });
  return true;
}

/**
 * The signal the turn's DM call carries. It stays readable after a cancel, so a cast cancelled
 * while queued behind another turn still reaches its DM call already aborted.
 */
export function sheetCastSignal(): AbortSignal | null {
  return controller?.signal ?? null;
}

/** True once the player cancelled the cast that is current or was just current. */
export function sheetCastCancelled(): boolean {
  return controller?.signal.aborted === true;
}

function movePhase(phase: SheetCastPhase, patch: Partial<SheetCastProgress> = {}): void {
  if (!snapshot.cast || snapshot.cast.phase === 'done') return;
  publish({ cast: { ...snapshot.cast, ...patch, phase, phaseStartedAt: Date.now() } });
}

/**
 * Ask the player to continue a save spell. For a cast pressed on the sheet (`fromSheet`) the dock
 * shows the card in `save` and goes back to `dm` on Continue. Any other cast (typed, or the DM's
 * own) shows only the card and never touches a sheet cast that may be queued behind it.
 */
export async function askTargetSave(
  spec: SpellTargetSaveSpec,
  fromSheet: boolean,
): Promise<SpellTargetSaveAnswer> {
  if (!fromSheet) return requestSpellTargetSave(spec);
  // The player cancelled while the DM's reply was on its way: no card for a cast already given up.
  if (sheetCastCancelled()) return 'cancel';
  movePhase('save', { targetName: spec.targetLabel });
  const answer = await requestSpellTargetSave(spec);
  if (answer === 'continue') movePhase('dm', { savePassed: true });
  return answer;
}

/** The player's own die for a sheet cast's spell attack: the dock says so and stops timing the DM. */
export async function withSheetCastRoll<T>(fromSheet: boolean, ask: () => Promise<T>): Promise<T> {
  if (!fromSheet || !snapshot.cast) return ask();
  movePhase('roll');
  try {
    return await ask();
  } finally {
    movePhase('dm');
  }
}

/**
 * The cast is about to be handed to the engine. Returns false when the player cancelled first; the
 * caller must then not commit. After a true, `cancelSheetCast` refuses: the slot is spent.
 */
export function beginSheetCastCommit(targetName?: string): boolean {
  if (sheetCastCancelled()) return false;
  if (snapshot.cast?.phase === 'resolving') return true;
  movePhase('resolving', {
    cancellable: false,
    ...(targetName ? { targetName } : {}),
  });
  return true;
}

/** The engine's cards for the player's own spell, for the dock's short result. */
export function reportSheetCastResult(card: EngineResultCard): void {
  if (!snapshot.cast) return;
  publish({ cast: { ...snapshot.cast, results: [...(snapshot.cast.results ?? []), card] } });
}

/**
 * The engine refused the area call and spent nothing, so the cast goes back to being cancellable
 * while it falls back to a single-target cast.
 */
export function reopenSheetCast(): void {
  if (snapshot.cast?.phase !== 'resolving') return;
  movePhase('dm', { cancellable: true });
}

/** The turn is over. A cast with a result stays in the dock until dismissed; any other is cleared. */
export function finishSheetCast(): void {
  controller = null;
  const { cast } = snapshot;
  if (!cast) return;
  publish({
    cast: cast.results?.length ? { ...cast, phase: 'done', phaseStartedAt: Date.now() } : null,
  });
}

export function dismissSheetCast(): void {
  if (snapshot.cast) publish({ cast: null });
}

/**
 * Cancel the cast: stop waiting for the DM, close any save card, and clear the dock. Returns false
 * when the engine already holds the cast (the slot is spent and stays spent).
 */
export function cancelSheetCast(): boolean {
  if (snapshot.cast && !snapshot.cast.cancellable) return false;
  // A card for a typed cast has no sheet cast behind it: nothing to abort, only the card to close.
  if (snapshot.cast) controller?.abort();
  publish({ cast: null });
  cancelPendingSpellTargetSave();
  return true;
}

/** Test seam: forget everything. */
export function resetSheetCastProgress(): void {
  controller = null;
  publish({ cast: null });
}
