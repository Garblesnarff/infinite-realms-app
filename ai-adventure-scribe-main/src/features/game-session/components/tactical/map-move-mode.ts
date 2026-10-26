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

export function useMapMoveModeRequested(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => pending,
    () => false,
  );
}
