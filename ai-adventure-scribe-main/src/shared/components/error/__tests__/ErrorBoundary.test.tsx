import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

import { ErrorBoundary } from '../ErrorBoundary';

import { setActiveClientFailureSessionId } from '@/services/client-failure-reporting';

function Bomb(): never {
  throw new Error('kaboom from Bomb');
}

function ActiveSessionBomb(): never {
  throw new Error('kaboom from ActiveSessionBomb');
}

describe('ErrorBoundary client-failure reporting (#2515)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setActiveClientFailureSessionId(undefined);
  });

  it('posts the caught failure to the client-failure endpoint once', () => {
    // React logs the caught error itself; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.reportClientFailure.mockClear();

    window.history.pushState({}, '', '/app/game/game-1?session=session-9');
    try {
      render(
        <ErrorBoundary level="component">
          <Bomb />
        </ErrorBoundary>,
      );
    } finally {
      window.history.pushState({}, '', '/');
    }

    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'react_error_boundary',
      'session-9',
      expect.stringContaining('at Bomb'),
      {
        component: 'Bomb',
        componentStack: expect.stringContaining('at Bomb'),
        message: 'kaboom from Bomb',
      },
    );
  });

  it('uses the active game session when the game route has no session query param', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.reportClientFailure.mockClear();
    setActiveClientFailureSessionId('active-session-9');
    window.history.pushState({}, '', '/app/game/game-1?character=char-1&starterCampaign=abyss');
    try {
      render(
        <ErrorBoundary level="route">
          <ActiveSessionBomb />
        </ErrorBoundary>,
      );
    } finally {
      window.history.pushState({}, '', '/');
    }

    expect(mocks.reportClientFailure).toHaveBeenCalledWith(
      'react_error_boundary',
      'active-session-9',
      expect.stringContaining('at ActiveSessionBomb'),
      expect.objectContaining({ component: 'ActiveSessionBomb' }),
    );
  });
});
