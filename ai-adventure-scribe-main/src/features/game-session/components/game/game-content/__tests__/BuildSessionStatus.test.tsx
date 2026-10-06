import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Vitest does not apply Vite's `define`, so the real constant is "dev" here. Rebuild it the way
// the app does from the served index.html: the app-version meta, cut to 8 characters.
vi.mock('@/services/app-version', async (importOriginal) => {
  const actual = await importOriginal<typeof AppVersion>();
  const { servedIndexHtml } =
    await import('../../../../../../../shared/test-fixtures/served-index-html');
  return {
    ...actual,
    APP_BUILD_SHORT: actual.shortBuildVersion(
      actual.extractServedAppVersion(servedIndexHtml) ?? '',
    ),
  };
});

import { BuildSessionStatus } from '../BuildSessionStatus';

import type * as AppVersion from '@/services/app-version';

// #2583 run D6/D7: a player reporting a stuck game had nothing to quote - no build text and no
// session id anywhere in the game UI. Fixtures follow the real producers: the build is the app-version
// meta of the shared served index.html (shared/test-fixtures/served-index-html.ts, also read by
// the /version test), cut by shortBuildVersion; SESSION_ID is the real GameSession.id -
// the uuid useGameSession hands down from the session load payload.

const SESSION_ID = '72ff7843-6e2d-41ae-9e48-5c5294a31244';

function mockClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

describe('BuildSessionStatus (#2583)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the short build SHA and the short session id', () => {
    render(<BuildSessionStatus sessionId={SESSION_ID} />);

    expect(screen.getByTestId('build-session-status')).toHaveTextContent(
      'build 3fa7eefe · session 72ff7843',
    );
  });

  it('copies the build and both forms of the session id', async () => {
    const writeText = mockClipboard();
    render(<BuildSessionStatus sessionId={SESSION_ID} />);

    await userEvent.click(screen.getByTestId('build-session-status'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('build 3fa7eefe');
    expect(copied).toContain('session 72ff7843');
    // The full id travels in the clipboard even though only the short form is on screen.
    expect(copied).toContain(SESSION_ID);
  });

  it('shows "Copied" on the button without any Toaster', async () => {
    mockClipboard();
    render(<BuildSessionStatus sessionId={SESSION_ID} />);

    await userEvent.click(screen.getByTestId('build-session-status'));

    expect(await screen.findByRole('button', { name: /Copy build/ })).toHaveTextContent('Copied');
  });

  it('shows "Copy failed" when writeText rejects', async () => {
    mockClipboard().mockRejectedValue(new Error('denied'));
    render(<BuildSessionStatus sessionId={SESSION_ID} />);

    await userEvent.click(screen.getByTestId('build-session-status'));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });

  it('shows "Copy failed" instead of throwing when navigator.clipboard is undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    render(<BuildSessionStatus sessionId={SESSION_ID} />);

    await userEvent.click(screen.getByTestId('build-session-status'));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });
});
