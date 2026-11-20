import { useEffect, useState, useSyncExternalStore } from 'react';

import type { ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';
import {
  PAGE_LOADING_BAR_DELAY_MS,
  PAGE_LOAD_STALL_MS,
  getPendingPageChunkSince,
  subscribePendingPageChunks,
} from '@/routes/route-chunk-progress';

type Phase = 'loading' | 'stalled';

/**
 * Shows that a route page is still loading. The old page stays on screen while the
 * URL has moved on, so without this a slow or stalled chunk looks like a dead click.
 */
export function RoutePendingIndicator(): ReactElement | null {
  const since = useSyncExternalStore(
    subscribePendingPageChunks,
    getPendingPageChunkSince,
    getPendingPageChunkSince,
  );
  const [state, setState] = useState<{ since: number; phase: Phase } | null>(null);

  useEffect(() => {
    if (since === null) return;
    const elapsed = Math.max(0, Date.now() - since);
    const barTimer = setTimeout(
      () => setState({ since, phase: 'loading' }),
      Math.max(0, PAGE_LOADING_BAR_DELAY_MS - elapsed),
    );
    const stallTimer = setTimeout(
      () => setState({ since, phase: 'stalled' }),
      Math.max(0, PAGE_LOAD_STALL_MS - elapsed),
    );
    return () => {
      clearTimeout(barTimer);
      clearTimeout(stallTimer);
    };
  }, [since]);

  if (since === null || state?.since !== since) return null;
  if (state.phase === 'stalled') {
    return (
      <div
        role="alert"
        className="fixed inset-0 flex items-center justify-center bg-background/80 p-6"
        style={{ zIndex: Z_INDEX.LOADING_OVERLAY }}
      >
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-bold">This page did not load</h1>
          <p className="text-muted-foreground">
            The connection or an app update may have interrupted it. Reload to try again.
          </p>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </div>
      </div>
    );
  }
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="fixed inset-x-0 top-0 h-1 overflow-hidden bg-infinite-purple/20"
      style={{ zIndex: Z_INDEX.LOADING_OVERLAY }}
    >
      <div className="h-full w-1/3 animate-pulse bg-infinite-gold" />
    </div>
  );
}
