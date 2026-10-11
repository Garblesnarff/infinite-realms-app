import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GameErrorFallback } from '../GameErrorFallback';

import { APP_BUILD_SHORT } from '@/services/app-version';
import { setActiveClientFailureSessionId } from '@/services/client-failure-reporting';

function renderCard(props: { error?: Error; reset?: () => void } = {}): void {
  render(
    <MemoryRouter initialEntries={['/app/game/abc']}>
      <GameErrorFallback {...props} />
    </MemoryRouter>,
  );
}

afterEach(() => {
  setActiveClientFailureSessionId(undefined);
  vi.restoreAllMocks();
});

describe('GameErrorFallback (#173)', () => {
  // The game route wires the card as <GameErrorFallback /> with no props
  // (GameContentWithErrorBoundary), so the zero-prop render is the production case.

  it('shows the build SHA with no session (production configuration)', () => {
    renderCard();

    expect(screen.getByTestId('game-error-context')).toHaveTextContent(`build ${APP_BUILD_SHORT}`);
  });

  it('shows "Session <short> · build <sha>" when a session is active (production configuration)', () => {
    setActiveClientFailureSessionId('abc12345-def6-7890-ghij-klmnopqrstuv');

    renderCard();

    expect(screen.getByTestId('game-error-context')).toHaveTextContent(
      `Session abc12345 · build ${APP_BUILD_SHORT}`,
    );
  });

  it('copies session, build, and route on "Copy details" (production configuration)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    setActiveClientFailureSessionId('abc12345-def6-7890-ghij-klmnopqrstuv');

    renderCard();
    fireEvent.click(screen.getByTestId('copy-details-button'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('session: abc12345-def6-7890-ghij-klmnopqrstuv');
    expect(copied).toContain(`build: ${APP_BUILD_SHORT}`);
    // The card quotes the real browser URL, not the router's memory path.
    expect(copied).toContain(`route: ${window.location.pathname}`);
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('shows "Copy failed" when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });

    renderCard();
    fireEvent.click(screen.getByTestId('copy-details-button'));

    expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  });

  // The card's documented props contract (the @example in GameErrorFallback):
  // when a caller passes error/reset, the message shows and the restart button fires.

  it('shows the error message and restart button when given error/reset props', () => {
    const reset = vi.fn();
    renderCard({ error: new Error('boom'), reset });

    expect(screen.getByText('Error: boom')).toBeInTheDocument();
    expect(screen.getByTestId('copy-details-button')).toHaveTextContent('Copy details');

    fireEvent.click(screen.getByRole('button', { name: 'Restart Game Session' }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Return to Campaign Hub' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeInTheDocument();
  });
});
