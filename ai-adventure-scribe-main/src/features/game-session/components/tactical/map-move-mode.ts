import { useSyncExternalStore } from 'react';

/**
 * #90: the ActionBar's Move button asks the tactical map to open in move mode. The map board
 * may live in the left rail or in the phone sheet, so the request goes through this one flag:
 * whichever board is mounted takes it and selects the player's token.
 */
let pending = false;
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((listener) => listener());

export function requestMapMoveMode(): void {
  pending = true;
  emit();
}

/** The board took the request; it does not fire again. */
export function consumeMapMoveMode(): void {
  if (!pending) return;
  pending = false;
  emit();
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useMapMoveModeRequested(): boolean {
  return useSyncExternalStore(subscribe, () => pending, () => false);
}

/**
 * #1797: Move mode is armed while the board has a token selected with its reachable squares
 * showing. The Move button reads this, so it can only look pressed when the map will take a move.
 * The board sets it; a turn change clears it.
 */
let armed = false;

export function setMoveModeArmed(next: boolean): void {
  if (armed === next) return;
  armed = next;
  emit();
}

export function useMoveModeArmed(): boolean {
  return useSyncExternalStore(subscribe, () => armed, () => false);
}
