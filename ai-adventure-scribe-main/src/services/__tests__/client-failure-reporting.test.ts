import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

import {
  CLIENT_FAILURE_REPORT_INTERVAL_MS,
  installGlobalClientFailureReporting,
  reportReactErrorBoundaryFailure,
  reportUnhandledPromiseRejection,
} from '../client-failure-reporting';

describe('client-failure-reporting (#2515)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts an unhandled promise rejection once, with the rejection message', () => {
    reportUnhandledPromiseRejection(new Error('socket exploded'), 1_000);

    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'unhandled_promise_rejection',
      undefined,
      'socket exploded',
    );
  });

  it('stringifies non-Error rejection reasons', () => {
    reportUnhandledPromiseRejection('plain string failure', 2_000);

    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'unhandled_promise_rejection',
      undefined,
      'plain string failure',
    );
  });

  it('suppresses a repeat of the same rejection within the report interval', () => {
    reportUnhandledPromiseRejection(new Error('same boom'), 10_000);
    reportUnhandledPromiseRejection(
      new Error('same boom'),
      10_000 + CLIENT_FAILURE_REPORT_INTERVAL_MS - 1,
    );
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);

    reportUnhandledPromiseRejection(
      new Error('same boom'),
      10_000 + CLIENT_FAILURE_REPORT_INTERVAL_MS,
    );
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(2);
  });

  it('includes the active session id from the game route session param (#2515)', () => {
    // Session pages carry the id as `?session=` on /app/game/:id (the shape
    // GameContent reads); outside a session it stays absent.
    window.history.pushState({}, '', '/app/game/campaign-1?character=c-1&session=sess-9');
    try {
      reportUnhandledPromiseRejection(new Error('in-session rejection'), 30_000);
    } finally {
      window.history.pushState({}, '', '/');
    }

    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'unhandled_promise_rejection',
      'sess-9',
      'in-session rejection',
    );
  });

  it('posts a React error-boundary failure with the caught component name', () => {
    const error = new Error('render blew up');
    error.stack = 'Error: render blew up\n    at GameContent (chunk.js:1:1)';
    reportReactErrorBoundaryFailure(error, '\n    at GameContent (chunk.js:1:1)', 20_000);

    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'react_error_boundary',
      undefined,
      error.stack,
      {
        component: 'GameContent',
        componentStack: '\n    at GameContent (chunk.js:1:1)',
        message: 'render blew up',
      },
    );
  });

  it('skips URL frames when extracting a component name', () => {
    const error = new Error('minified render blew up');
    error.stack = 'Error: minified render blew up\n    at https://host/assets/main-X.js:1:2';
    reportReactErrorBoundaryFailure(
      error,
      '\n    at https://host/assets/main-X.js:1:2\n    at DiceRollMessage (chunk.js:1:1)',
      21_000,
    );

    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'react_error_boundary',
      undefined,
      error.stack,
      expect.objectContaining({ component: 'DiceRollMessage' }),
    );
  });

  describe('installGlobalClientFailureReporting', () => {
    let cleanup: (() => void) | null = null;

    afterEach(() => {
      cleanup?.();
      cleanup = null;
    });

    // jsdom has no PromiseRejectionEvent constructor; the listener only reads
    // `event.reason`, so a plain Event carrying one is the same shape.
    const rejectionEvent = (reason: unknown): Event => {
      const event = new Event('unhandledrejection');
      Object.assign(event, { reason, promise: Promise.resolve() });
      return event;
    };

    it('reports a window unhandledrejection event once, even when installed twice', () => {
      cleanup = installGlobalClientFailureReporting();
      const secondCleanup = installGlobalClientFailureReporting();
      expect(secondCleanup).toBe(cleanup);

      window.dispatchEvent(rejectionEvent(new Error('late rejection')));

      expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
      expect(mocks.reportClientFailure).toHaveBeenCalledWith(
        'unhandled_promise_rejection',
        undefined,
        'late rejection',
      );
    });

    it('stops reporting after the cleanup runs', () => {
      cleanup = installGlobalClientFailureReporting();
      cleanup();
      cleanup = null;

      window.dispatchEvent(rejectionEvent(new Error('after cleanup')));

      expect(mocks.reportClientFailure).not.toHaveBeenCalled();
    });
  });
});
