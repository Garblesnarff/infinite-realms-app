import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reportClientFailure: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: mocks.reportClientFailure },
}));

// Vitest does not apply Vite's `define`, so the real constant is "dev" here. Rebuild it the way
// the app does from the served index.html: the app-version meta, cut to 8 characters.
vi.mock('@/services/app-version', async (importOriginal) => {
  const actual = await importOriginal<typeof AppVersion>();
  const { servedIndexHtml } = await import('../../../../../shared/test-fixtures/served-index-html');
  return {
    ...actual,
    APP_BUILD_SHORT: actual.shortBuildVersion(
      actual.extractServedAppVersion(servedIndexHtml) ?? '',
    ),
  };
});

import { ErrorBoundary } from '../ErrorBoundary';

import type * as AppVersion from '@/services/app-version';

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

// #2583 run D6: the crash card showed a raw JS message with Try Again / Reload Page and nothing a
// player could quote. Fixtures follow the real producers: the build is the app-version meta of
// the shared served index.html (shared/test-fixtures/served-index-html.ts, also read by the
// /version test), cut by shortBuildVersion; the card is the one the game screen shows, from
// GameProviders.tsx (`level="feature"`, no fallback); the session id is the uuid useGameSession resolves from the session load payload, which it
// publishes through setActiveClientFailureSessionId - the same value the CLIENT_FAILURE report is keyed by.

const SESSION_ID = '72ff7843-6e2d-41ae-9e48-5c5294a31244';
const GAME_ROUTE = '/app/game/4c9f2b8e-1a77-4c2e-9d31-5b6a7c8d9e0f';

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

/** A component that throws `message`, so each test gets a reporter key of its own. */
function bombThatThrows(message: string): () => never {
  return function Bomb(): never {
    throw new Error(message);
  };
}

function renderFeatureCard(): void {
  render(
    <ErrorBoundary level="feature">
      <Bomb />
    </ErrorBoundary>,
  );
}

describe('ErrorBoundary crash card (#2583)', () => {
  const originalUrl = window.location.href;

  beforeEach(() => {
    mocks.reportClientFailure.mockClear();
    // React logs the caught error itself; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setActiveClientFailureSessionId(undefined);
    // The shape of the URL a game actually runs at. A session started from character selection
    // carries `character` and `new`, never `session` (see use-character-selection).
    window.history.replaceState(
      {},
      '',
      `${GAME_ROUTE}?character=char-uuid&starterCampaign=abyssal`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setActiveClientFailureSessionId(undefined);
    window.history.replaceState({}, '', originalUrl);
  });

  it('keeps the message and names the session even when the URL carries no session param', () => {
    // This is the run D6 path: a brand-new game, crashed before anything put ?session= in the URL.
    setActiveClientFailureSessionId(SESSION_ID);

    render(
      <ErrorBoundary level="feature">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByText('kaboom from Bomb')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-context')).toHaveTextContent(
      'Session 72ff7843 · build 3fa7eefe',
    );
  });

  it('copies message, session id, build and route', async () => {
    const writeText = mockClipboard();
    setActiveClientFailureSessionId(SESSION_ID);

    render(
      <ErrorBoundary level="feature">
        <Bomb />
      </ErrorBoundary>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('error: kaboom from Bomb');
    expect(copied).toContain(`session: ${SESSION_ID}`);
    expect(copied).toContain('build: 3fa7eefe');
    expect(copied).toContain(`route: ${GAME_ROUTE}`);
  });

  it('falls back to the session param of a resumed session', () => {
    window.history.replaceState({}, '', `${GAME_ROUTE}?session=${SESSION_ID}`);

    render(
      <ErrorBoundary level="feature">
        <Bomb />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary-context')).toHaveTextContent(
      'Session 72ff7843 · build 3fa7eefe',
    );
  });

  it('copies without adding a second client-failure report', async () => {
    // #2577 already logs this failure server-side. The copy action only touches the clipboard,
    // so the report count must be identical before and after the click. This Bomb throws a
    // message of its own: the reporter rate-limits an identical message to once a minute, and a
    // repeated message would make this comparison read 0 === 0 for the wrong reason.
    const writeText = mockClipboard();
    setActiveClientFailureSessionId(SESSION_ID);
    const Bomb = bombThatThrows('a message no other test reports');

    render(
      <ErrorBoundary level="feature">
        <Bomb />
      </ErrorBoundary>,
    );

    // The boundary itself reports exactly once, so this is a real count and not a zero.
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(mocks.reportClientFailure).toHaveBeenCalledTimes(1);
  });

  // The app-level boundary (App.tsx) wraps the sonner Toaster, so no Toaster is rendered here and
  // the button has to carry the result itself.
  it('shows "Copied" on the button without any Toaster', async () => {
    mockClipboard();
    renderFeatureCard();

    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('shows "Copy failed" when writeText rejects', async () => {
    const writeText = mockClipboard();
    writeText.mockRejectedValue(new Error('denied'));
    renderFeatureCard();

    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });

  it('shows "Copy failed" instead of throwing when navigator.clipboard is undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    renderFeatureCard();

    await userEvent.click(screen.getByRole('button', { name: 'Copy details' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });
});
