/** #1797: a burst of map changes shares one weapon-list read. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createThrottledTrigger } from './legal-actions-refresh-throttle';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createThrottledTrigger (#1797)', () => {
  it('five changes in a row make at most two runs', () => {
    const run = vi.fn();
    const throttle = createThrottledTrigger(run, 150);
    for (let i = 0; i < 5; i++) throttle.trigger();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(150);
    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a change after the window runs at once', () => {
    const run = vi.fn();
    const throttle = createThrottledTrigger(run, 150);
    throttle.trigger();
    vi.advanceTimersByTime(300);
    throttle.trigger();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancel drops a pending trailing run', () => {
    const run = vi.fn();
    const throttle = createThrottledTrigger(run, 150);
    throttle.trigger();
    throttle.trigger();
    throttle.cancel();
    vi.advanceTimersByTime(500);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
