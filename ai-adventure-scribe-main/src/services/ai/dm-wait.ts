import { useSyncExternalStore } from 'react';

/**
 * Whether a call to the DM is in flight. The "Dungeon Master is thinking…" pill reads this: the
 * message queue's own status only covers the database write of the player's message, so the pill
 * went out long before the 20 to 60 s the model takes (#2418). Calls are counted, because one turn
 * can make two (the declaration, then the narration of what the engine resolved).
 */
let inFlight = 0;
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const isWaiting = (): boolean => inFlight > 0;

export function useDmWaiting(): boolean {
  return useSyncExternalStore(subscribe, isWaiting, isWaiting);
}

/** Counts `call` as a DM wait until it settles, and hands its outcome back unchanged. */
export function trackDmWait<T>(call: Promise<T>): Promise<T> {
  inFlight += 1;
  notify();
  const done = (): void => {
    inFlight -= 1;
    notify();
  };
  call.then(done, done);
  return call;
}
