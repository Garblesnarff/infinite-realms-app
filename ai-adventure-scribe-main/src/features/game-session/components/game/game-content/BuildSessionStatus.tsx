/**
 * BuildSessionStatus - the build SHA and session id a player can read and quote.
 *
 * A tester reporting a stuck game used to have nothing to quote: no build text anywhere in the
 * game UI, and no session id on screen or in the URL (run D6/D7, #2583/#2584). This line sits in
 * the game header bar - an existing flex-wrap row that already gives way on a short screen - so
 * it adds no height to the story column and never reaches the composer dock below it.
 *
 * Dependencies: the build stamp baked in by Vite (`@/services/app-version`, the same producer
 * that fills index.html's app-version meta tag) and the session id GameContent resolved.
 */
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';

import { APP_BUILD_SHORT } from '@/services/app-version';

interface BuildSessionStatusProps {
  /**
   * The resolved game session id (GameSession.id). `GameContent` returns the loading screen
   * until this exists, so it is always a real id here.
   */
  sessionId: string;
}

/** The first 8 characters of a session id, matching how the account page shows a build (#2293). */
function shortSessionId(sessionId: string): string {
  return sessionId.trim().slice(0, 8);
}

export const BuildSessionStatus: React.FC<BuildSessionStatusProps> = memo(({ sessionId }) => {
  const shortId = shortSessionId(sessionId);
  // One line a player can read at a glance; the full session id stays out of the UI on purpose.
  const summary = `build ${APP_BUILD_SHORT} · session ${shortId}`;

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  // The result shows on the button: the app-level error boundary wraps the toast host, so a toast
  // is not a feedback channel this line can rely on.
  const handleCopy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(
        `build ${APP_BUILD_SHORT}\nsession ${shortId}\nsession ${sessionId}`,
      );
      setCopyStatus('copied');
    } catch {
      // `navigator.clipboard` is undefined outside secure contexts, and writeText can reject.
      setCopyStatus('failed');
    }
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyStatus('idle'), 2000);
  }, [sessionId, shortId]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      data-testid="build-session-status"
      aria-label={`Copy build and session id: ${summary}`}
      title="Copy build and session id"
      className="rounded px-1.5 py-0.5 font-mono text-[10px] leading-tight text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
    >
      {copyStatus === 'idle' ? summary : copyStatus === 'copied' ? 'Copied' : 'Copy failed'}
    </button>
  );
});

BuildSessionStatus.displayName = 'BuildSessionStatus';
