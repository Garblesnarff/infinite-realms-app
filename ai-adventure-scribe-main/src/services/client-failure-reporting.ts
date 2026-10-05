import { userDataApi } from '@/services/user-data-api';

/**
 * Reports the two client failures that previously died in the browser console:
 * unhandled promise rejections and React error-boundary catches (#2515). Both go
 * through `userDataApi.reportClientFailure`, so they land in the server log
 * (`CLIENT_FAILURE`) and page through the same `alert()` path as the continuity
 * failures from #1680, instead of being visible only in a tester's devtools.
 *
 * A failure storm must not flood the endpoint: the same kind+message is reported
 * at most once per minute, mirroring the batching in `websocket-observability.ts`.
 */
export const CLIENT_FAILURE_REPORT_INTERVAL_MS = 60 * 1000;

const lastReportedAtByKey = new Map<string, number>();
let activeGameSessionId: string | undefined;

function shouldReport(key: string, now: number): boolean {
  const lastReportedAt = lastReportedAtByKey.get(key);
  if (lastReportedAt !== undefined && now - lastReportedAt < CLIENT_FAILURE_REPORT_INTERVAL_MS) {
    return false;
  }
  lastReportedAtByKey.set(key, now);
  return true;
}

function failureMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === 'string') return reason;
  return String(reason);
}

/**
 * The active game session, when there is one: session pages carry it in the
 * `session` query param (`/app/game/:id?session=...`, the same place
 * `GameContent` and the breadcrumbs read it from), and the CLIENT_FAILURE log
 * line is keyed by it (#2515).
 */
export function setActiveClientFailureSessionId(sessionId: string | null | undefined): void {
  activeGameSessionId = sessionId ?? undefined;
}

function activeSessionId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    activeGameSessionId ?? new URLSearchParams(window.location.search).get('session') ?? undefined
  );
}

/** First component named in a React component stack (`at GameContent (...)`). */
function componentNameFromStack(componentStack?: string | null): string | undefined {
  if (!componentStack) return undefined;
  for (const line of componentStack.split('\n')) {
    const match = line.match(/^\s*at\s+([^\s(]+)/);
    if (match && !/^https?:\/\//.test(match[1])) return match[1];
  }
  return undefined;
}

export function reportUnhandledPromiseRejection(reason: unknown, now = Date.now()): void {
  const message = failureMessage(reason);
  if (!shouldReport(`unhandled_promise_rejection:${message}`, now)) return;
  userDataApi.reportClientFailure('unhandled_promise_rejection', activeSessionId(), message);
}

export function reportReactErrorBoundaryFailure(
  error: Error,
  componentStack?: string | null,
  now = Date.now(),
): void {
  const message = error.message;
  if (!shouldReport(`react_error_boundary:${message}`, now)) return;
  userDataApi.reportClientFailure(
    'react_error_boundary',
    activeSessionId(),
    error.stack ?? message,
    {
      component: componentNameFromStack(componentStack),
      componentStack: componentStack ?? undefined,
      message,
    },
  );
}

let installedCleanup: (() => void) | null = null;

/**
 * Install the global `unhandledrejection` listener. Idempotent: a second call
 * returns the existing cleanup instead of stacking another listener, so a
 * rejection is reported once even if the installer is mounted twice.
 */
export function installGlobalClientFailureReporting(): () => void {
  if (installedCleanup) return installedCleanup;
  if (typeof window === 'undefined') return () => {};

  const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
    reportUnhandledPromiseRejection(event.reason);
  };
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  const cleanup = (): void => {
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (installedCleanup === cleanup) installedCleanup = null;
  };
  installedCleanup = cleanup;
  return cleanup;
}
