import { lazy } from 'react';

import type { ComponentType, LazyExoticComponent } from 'react';

/**
 * Tracks route page chunks that are still loading. A navigation under
 * `v7_startTransition` keeps the old page on screen until the new chunk arrives,
 * with no fallback, so this is the only signal that a page is still loading (#1671).
 */

/** A page still loading after this long shows a thin progress bar (#1671). */
export const PAGE_LOADING_BAR_DELAY_MS = 300;
/** A page still loading after this long shows the error card with a Reload button (#1671). */
export const PAGE_LOAD_STALL_MS = 15_000;

type Listener = () => void;

let pendingCount = 0;
let pendingSince: number | null = null;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribePendingPageChunks(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Start time of the oldest page chunk still loading, or null when none is loading. */
export function getPendingPageChunkSince(): number | null {
  return pendingSince;
}

export function trackPageChunk<T>(load: () => Promise<T>): Promise<T> {
  if (pendingCount === 0) pendingSince = Date.now();
  pendingCount += 1;
  notify();
  return load().finally(() => {
    pendingCount -= 1;
    if (pendingCount === 0) pendingSince = null;
    notify();
  });
}

/** React.lazy for a route page, with its chunk load tracked. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => trackPageChunk(load));
}
