import { AlertTriangle, Home, RotateCcw } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { APP_BUILD_SHORT } from '@/services/app-version';
import { activeSessionId } from '@/services/client-failure-reporting';

/**
 * Props for the GameErrorFallback component
 */
interface GameErrorFallbackProps {
  error?: Error;
  reset?: () => void;
}

/** The first 8 characters of a session id, matching the boundary's context line. */
function shortSessionId(sessionId: string): string {
  return sessionId.trim().slice(0, 8);
}

/**
 * GameErrorFallback Component
 *
 * Specialized error fallback UI for game session errors.
 * Provides context-specific recovery options for game-related failures.
 *
 * Features:
 * - Game-themed error messaging
 * - Multiple recovery options (restart session, return home, reload)
 * - User-friendly error descriptions
 * - Maintains app navigation
 *
 * @example
 * ```tsx
 * <ErrorBoundary
 *   level="feature"
 *   fallback={<GameErrorFallback error={error} reset={reset} />}
 * >
 *   <GameContent />
 * </ErrorBoundary>
 * ```
 */
export const GameErrorFallback: React.FC<GameErrorFallbackProps> = ({ error, reset }) => {
  const navigate = useNavigate();

  const handleReturnHome = () => {
    navigate('/app');
  };

  const handleReload = () => {
    window.location.reload();
  };

  // What a player quotes when reporting this crash (#173): the session the
  // failure reporting already keyed its CLIENT_FAILURE line by, and the
  // running build. The failure itself is reported by the boundary's
  // componentDidCatch; the copy button below only touches the clipboard.
  const sessionId = activeSessionId();
  const contextLine = sessionId
    ? `Session ${shortSessionId(sessionId)} · build ${APP_BUILD_SHORT}`
    : `build ${APP_BUILD_SHORT}`;

  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleCopyDetails = async (): Promise<void> => {
    const details = [
      `error: ${error?.message ?? 'An unexpected error occurred.'}`,
      `session: ${sessionId ?? 'unknown'}`,
      `build: ${APP_BUILD_SHORT}`,
      `route: ${typeof window === 'undefined' ? '' : window.location.pathname}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(details);
      setCopyStatus('copied');
    } catch {
      // `navigator.clipboard` is undefined outside secure contexts, and writeText can reject.
      setCopyStatus('failed');
    }
    // A second click restarts the feedback window instead of letting the first timer cut it short.
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCopyStatus('idle'), 2000);
  };

  return (
    <div className="flex items-center justify-center h-screen bg-background p-4">
      <div className="max-w-lg w-full p-8 bg-card border border-destructive/20 rounded-lg shadow-lg">
        {/* Error Icon and Title */}
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="h-8 w-8 text-destructive flex-shrink-0" />
          <div>
            <h2 className="text-2xl font-semibold">Game Session Error</h2>
            <p className="text-sm text-muted-foreground">
              Your adventure encountered an unexpected problem
            </p>
          </div>
        </div>

        {/* Error Description */}
        <div className="mb-6 p-4 bg-muted/50 rounded border border-muted">
          <p className="text-sm text-foreground mb-2">
            Don't worry - your progress has been saved. You can try one of the following options to
            continue:
          </p>

          {error && (
            <p className="text-xs text-muted-foreground mt-2 font-mono">Error: {error.message}</p>
          )}

          <p
            className="text-xs text-muted-foreground mt-2 font-mono"
            data-testid="game-error-context"
          >
            {contextLine}
          </p>
        </div>

        {/* Recovery Options */}
        <div className="space-y-2">
          {reset && (
            <Button onClick={reset} variant="default" className="w-full" size="lg">
              <RotateCcw className="h-4 w-4 mr-2" />
              Restart Game Session
            </Button>
          )}

          <Button onClick={handleReturnHome} variant="outline" className="w-full" size="lg">
            <Home className="h-4 w-4 mr-2" />
            Return to Campaign Hub
          </Button>

          <Button onClick={handleReload} variant="ghost" className="w-full" size="sm">
            Reload Page
          </Button>

          <Button
            onClick={handleCopyDetails}
            variant="ghost"
            className="w-full"
            size="sm"
            data-testid="copy-details-button"
          >
            {copyStatus === 'idle'
              ? 'Copy details'
              : copyStatus === 'copied'
                ? 'Copied'
                : 'Copy failed'}
          </Button>
        </div>

        {/* Development Error Details */}
        {import.meta.env.DEV && error?.stack && (
          <details className="mt-6 p-3 bg-muted rounded text-xs">
            <summary className="cursor-pointer font-medium mb-2 text-muted-foreground">
              Error Stack (Development Only)
            </summary>
            <pre className="whitespace-pre-wrap overflow-x-auto text-xs">{error.stack}</pre>
          </details>
        )}
      </div>
    </div>
  );
};
