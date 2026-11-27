/**
 * #1776: the starter campaign request is bounded. A request that never answers ends in an
 * error after two attempts (5 s + 4 s), and retry() runs the load again.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';

// The Explore page's bounds (ExploreGalleryPage.tsx): first try 5 s, second 4 s.
const EXPLORE_TIMEOUTS_MS = [5_000, 4_000];
const BOUNDED = { attemptTimeoutsMs: EXPLORE_TIMEOUTS_MS };
const FIRST_ATTEMPT_MS = EXPLORE_TIMEOUTS_MS[0];
const BOTH_ATTEMPTS_MS = EXPLORE_TIMEOUTS_MS[0] + EXPLORE_TIMEOUTS_MS[1];

const fake = vi.hoisted(() => ({
  script: [] as Array<'hang' | 'ok'>,
  rows: [] as Record<string, unknown>[],
  calls: 0,
}));

// Each query waits for the next scripted outcome: 'ok' answers with rows, 'hang' never answers
// and rejects only when the caller aborts it.
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
      fake.calls += 1;
      const mode = fake.script.shift() ?? 'ok';
      const outcome =
        mode === 'ok'
          ? Promise.resolve({ data: fake.rows, error: null })
          : new Promise((_resolve, rejectAborted) => {
              // Only a bounded call has a signal; an unbounded call never answers.
              (q.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
                rejectAborted(new DOMException('aborted', 'AbortError')),
              );
            });
      return outcome.then(resolve, reject);
    };
    return q;
  }
  return { supabase: { from: () => query() } };
});

const row = {
  id: 'camp-1',
  slug: 'the-crypt',
  title: 'The Crypt',
  tagline: null,
  genre: [],
  tone: [],
  difficulty: 'easy',
  level_range: null,
  estimated_sessions: null,
  premise: 'A premise',
  is_complete: true,
  is_published: true,
  is_featured: false,
  cover_image_url: null,
  banner_image_url: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  fake.script = [];
  fake.rows = [row];
  fake.calls = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useStarterCampaigns: bounded load (#1776)', () => {
  it('a request that never answers ends in an error after two bounded attempts', async () => {
    fake.script = ['hang', 'hang'];
    const { result } = renderHook(() => useStarterCampaigns(BOUNDED));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOTH_ATTEMPTS_MS);
    });

    expect(fake.calls).toBe(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error?.message).toBe('The campaign list took too long to load');
    expect(result.current.campaigns).toEqual([]);
  });

  it('a slow first attempt is retried once and the list loads', async () => {
    fake.script = ['hang', 'ok'];
    const { result } = renderHook(() => useStarterCampaigns(BOUNDED));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FIRST_ATTEMPT_MS);
    });

    expect(fake.calls).toBe(2);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.campaigns.map((c) => c.title)).toEqual(['The Crypt']);
  });

  it('retry() runs the load again after an error', async () => {
    fake.script = ['hang', 'hang'];
    const { result } = renderHook(() => useStarterCampaigns(BOUNDED));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOTH_ATTEMPTS_MS);
    });
    expect(result.current.error).not.toBeNull();

    fake.script = ['ok'];
    act(() => result.current.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.campaigns).toHaveLength(1);
  });

  it('a caller without the option waits with no bound and never shows an error', async () => {
    fake.script = ['hang'];
    const { result } = renderHook(() => useStarterCampaigns());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fake.calls).toBe(1);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.error).toBeNull();
  });
});
