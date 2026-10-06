import { AlertTriangle } from 'lucide-react';
import React, { Component } from 'react';

import type { ErrorInfo, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import logger from '@/lib/logger';
import { APP_BUILD_SHORT } from '@/services/app-version';
import {
  activeSessionId,
  reportReactErrorBoundaryFailure,
} from '@/services/client-failure-reporting';

/** First 8 characters of the session id, matching how the game header shows it (#2293). */
function shortSessionId(sessionId: string): string {
  return sessionId.trim().slice(0, 8);
}

/**
 * Props for the ErrorBoundary component
 */
interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  level?: 'app' | 'route' | 'feature' | 'component';
}

/**
 * State for the ErrorBoundary component
 */
interface State {
  hasError: boolean;
  error: Error | null;
  copyStatus: 'idle' | 'copied' | 'failed';
}

/**
 * ErrorBoundary Component
 *
 * React Error Boundary for graceful error handling and recovery.
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 *
 * @example
 * ```tsx
 * <ErrorBoundary level="app" onError={reportError}>
 *   <App />
 * </ErrorBoundary>
 * ```
 *
 * Features:
 * - Multiple error boundary levels (app, route, feature, component)
 * - Custom fallback UI support
 * - Error logging with context
 * - Reset functionality to recover from errors
 * - Reload page option for critical errors
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, copyStatus: 'idle' };
  }

  /**
   * Update state when an error is caught
   * This lifecycle method is called during the render phase
   */
  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, copyStatus: 'idle' };
  }

  /**
   * Log error details when an error is caught
   * This lifecycle method is called during the commit phase
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { level = 'component', onError } = this.props;

    // Log error with context
    logger.error(`[ErrorBoundary:${level}] Component error caught:`, {
      error,
      errorInfo,
      componentStack: errorInfo.componentStack,
      message: error.message,
      stack: error.stack,
    });

    // Report it to the server too (#2515): a boundary catch is exactly the
    // silent dead-end that otherwise only exists in this console log.
    reportReactErrorBoundaryFailure(error, errorInfo.componentStack);

    // Call custom error handler if provided
    onError?.(error, errorInfo);
  }

  /**
   * Reset error state to attempt recovery
   */
  handleReset = () => {
    this.setState({ hasError: false, error: null, copyStatus: 'idle' });
  };

  /**
   * Reload the page for critical errors
   */
  handleReload = () => {
    window.location.reload();
  };

  /** The "Session <short> · build <sha>" line under the error message (#2583). */
  renderContextLine = (): string => {
    const sessionId = activeSessionId();
    return sessionId
      ? `Session ${shortSessionId(sessionId)} · build ${APP_BUILD_SHORT}`
      : `build ${APP_BUILD_SHORT}`;
  };

  /**
   * Copy the four fields a support reply needs. The card is otherwise a dead end for the player:
   * it showed a raw JS message and two buttons, nothing they could quote (#2583). The failure is
   * already reported by componentDidCatch; this only touches the clipboard. The result shows on
   * the button itself: the app-level boundary wraps the toast host, so a toast would not render.
   */
  handleCopyDetails = async (): Promise<void> => {
    const sessionId = activeSessionId();
    const details = [
      `error: ${this.state.error?.message || 'An unexpected error occurred. Please try again.'}`,
      `session: ${sessionId ?? 'unknown'}`,
      `build: ${APP_BUILD_SHORT}`,
      `route: ${typeof window === 'undefined' ? '' : window.location.pathname}`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(details);
      this.setState({ copyStatus: 'copied' });
    } catch {
      // `navigator.clipboard` is undefined outside secure contexts, and writeText can reject.
      this.setState({ copyStatus: 'failed' });
    }
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback UI
      return (
        <div className="flex items-center justify-center min-h-screen bg-background p-4">
          <div className="max-w-md w-full p-8 bg-card border border-destructive/20 rounded-lg shadow-lg">
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle className="h-6 w-6 text-destructive flex-shrink-0" />
              <h2 className="text-xl font-semibold">Something went wrong</h2>
            </div>

            <p className="text-muted-foreground mb-4">
              {this.state.error?.message || 'An unexpected error occurred. Please try again.'}
            </p>

            {/* What a player quotes when reporting this crash (#2583). */}
            <p
              className="mb-4 font-mono text-xs text-muted-foreground"
              data-testid="error-boundary-context"
            >
              {this.renderContextLine()}
            </p>

            {/* Show additional error details in development */}
            {import.meta.env.DEV && this.state.error?.stack && (
              <details className="mb-4 p-3 bg-muted rounded text-xs">
                <summary className="cursor-pointer font-medium mb-2">Error Details</summary>
                <pre className="whitespace-pre-wrap overflow-x-auto">{this.state.error.stack}</pre>
              </details>
            )}

            <div className="flex flex-wrap gap-2">
              <Button onClick={this.handleReset} variant="default">
                Try Again
              </Button>
              <Button onClick={this.handleReload} variant="outline">
                Reload Page
              </Button>
              <Button onClick={this.handleCopyDetails} variant="ghost">
                {
                  { idle: 'Copy details', copied: 'Copied', failed: 'Copy failed' }[
                    this.state.copyStatus
                  ]
                }
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
