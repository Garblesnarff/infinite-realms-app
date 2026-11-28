/**
 * #1776 (Hark W25-002): the explore page never sits on "Loading campaigns…" past 10 s. A hung
 * campaign request or a stalled auth check ends in the list or an error with Try again.
 */
import { act, render, screen } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ExploreGalleryPage from '../ExploreGalleryPage';

const fake = vi.hoisted(() => ({ script: [] as Array<'hang' | 'ok'> }));
const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false }));

vi.mock('@/integrations/supabase/client', () => {
  function query(): Record<string, unknown> {
    const q: Record<string, unknown> = {};
    const self = (): Record<string, unknown> => q;
    q.select = self;
    q.eq = self;
    q.order = self;
    q.abortSignal = (signal: AbortSignal): Record<string, unknown> => {
      q.signal = signal;
      return q;
    };
    q.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      const mode = fake.script.shift() ?? 'ok';
      const outcome =
        mode === 'ok'
          ? Promise.resolve({ data: [], error: null })
          : new Promise((_resolve, rejectAborted) => {
              (q.signal as AbortSignal).addEventListener('abort', () =>
                rejectAborted(new DOMException('aborted', 'AbortError')),
              );
            });
      return outcome.then(resolve, reject);
    };
    return q;
  }
  return { supabase: { from: () => query() } };
});

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

const renderPage = (): ReturnType<typeof render> =>
  render(
    <HelmetProvider>
      <MemoryRouter>
        <ExploreGalleryPage />
      </MemoryRouter>
    </HelmetProvider>,
  );

beforeEach(() => {
  vi.useFakeTimers();
  auth.loading = false;
  auth.user = null;
  fake.script = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ExploreGalleryPage: slow load (#1776)', () => {
  it('a hung campaign request shows an error with Try again within 10 seconds', async () => {
    fake.script = ['hang', 'hang'];
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading campaigns' })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.queryByRole('status', { name: 'Loading campaigns' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load the campaigns.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a stalled auth check shows an error with Try again within 10 seconds', async () => {
    auth.loading = true;
    renderPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.queryByRole('status', { name: 'Loading campaigns' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('We could not load the campaigns.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a fast load shows no error and no Try again button', async () => {
    renderPage();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('No campaigns available yet. Check back soon!')).toBeInTheDocument();
  });
});
