import { act, render, screen, waitFor } from '@testing-library/react';
import { Toaster } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStaleClientCheck } from '../use-stale-client-check';

/**
 * #1161 (Hark T27-006): the "New version available" toast rendered at sonner's default
 * bottom-right and covered the composer's Send button for the rest of the run. This renders
 * the real Toaster (as App.tsx mounts it) with the real hook and the real use-toast wrapper,
 * so the placement and the close button are read from the DOM sonner produces.
 */
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { reportClientFailure: vi.fn() },
}));

const indexHtml = (version: string): string =>
  `<!doctype html><html><head><meta name="app-version" content="${version}" /></head></html>`;

function Harness(): JSX.Element {
  useStaleClientCheck({ isInCombat: false, sessionId: 'session-1' });
  return <div>game page</div>;
}

describe('stale-client toast placement (#1161)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(indexHtml('a-newer-build'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders at the top center, clear of the bottom composer, with a close button', async () => {
    render(
      <>
        <Harness />
        <Toaster />
      </>,
    );

    const title = await screen.findByText('New version available');
    const toaster = title.closest('[data-sonner-toaster]');
    expect(toaster).not.toBeNull();
    expect(toaster).toHaveAttribute('data-y-position', 'top');
    expect(toaster).toHaveAttribute('data-x-position', 'center');
    // Sonner keeps a section for its default (bottom-right) position; no toast may sit in it.
    expect(
      document.querySelector('[data-sonner-toaster][data-y-position="bottom"] [data-sonner-toast]'),
    ).toBeNull();

    const toast = title.closest('[data-sonner-toast]') as HTMLElement;
    const close = toast.querySelector('button[aria-label="Close toast"]') as HTMLButtonElement;
    expect(close).not.toBeNull();
    act(() => close.click());
    await waitFor(() => expect(screen.queryByText('New version available')).toBeNull());
  });
});
