/**
 * #847: rate-limit maps must evict buckets that have been idle longer
 * than their window, instead of growing for the life of the process.
 *
 * The MemoryStore is exercised directly so the assertion is on the map
 * itself: a mere black-box check through incr() could not tell an evicted
 * bucket from one reset in place (both start the count over at 1).
 */

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';

import {
  MemoryStore,
  rateLimitWarnMapSizeForTests,
  resetRateLimitWarnForTests,
  shouldWarnRateLimit,
} from '../rate-limit.js';

afterEach(() => {
  setSystemTime(); // back to real time between tests
  resetRateLimitWarnForTests(); // the warn map is module-global
});

describe('rate-limit bucket eviction (#847)', () => {
  it('evicts a bucket idle longer than its window on the next insert', () => {
    const store = new MemoryStore();
    const t0 = Date.now();

    store.incr('stale:ip:10.0.0.1', 1_000);
    expect(store.size).toBe(1);

    setSystemTime(t0 + 1_500); // past the 1s window

    store.incr('fresh:ip:10.0.0.2', 1_000); // triggers the lazy sweep
    expect(store.size).toBe(1); // stale bucket gone, only the fresh one remains
  });

  it('keeps buckets that are still inside their window', () => {
    const store = new MemoryStore();
    const t0 = Date.now();

    store.incr('active:ip:10.0.0.3', 60_000);
    setSystemTime(t0 + 30_000); // halfway through the window

    store.incr('other:ip:10.0.0.4', 60_000); // triggers the lazy sweep
    expect(store.size).toBe(2);
  });

  it('evicts each bucket by its own window, not the window of the triggering insert', () => {
    const store = new MemoryStore();
    const t0 = Date.now();

    store.incr('short:ip:10.0.0.5', 1_000);
    store.incr('long:ip:10.0.0.6', 60_000);
    expect(store.size).toBe(2);

    setSystemTime(t0 + 5_000); // past the 1s window, inside the 60s window

    store.incr('trigger:ip:10.0.0.7', 1_000);
    expect(store.size).toBe(2); // only the short-window bucket is evicted
  });

  it('sweeps at most once per eviction interval, but still evicts on the next sweep', () => {
    const store = new MemoryStore();
    const t0 = Date.now();

    store.incr('anchor:ip:10.0.0.9', 60_000); // first sweep runs here
    setSystemTime(t0 + 500);
    store.incr('stale:ip:10.0.0.10', 100); // sweep throttled (500ms < 1s interval)
    setSystemTime(t0 + 700); // 'stale' is now past its 100ms window

    store.incr('probe:ip:10.0.0.11', 60_000); // still inside the interval: no sweep
    expect(store.size).toBe(3); // stale bucket not yet evicted

    setSystemTime(t0 + 1_500); // past the 1s eviction interval
    store.incr('probe2:ip:10.0.0.12', 60_000); // sweep runs again
    expect(store.size).toBe(3); // anchor + probe + probe2; stale is gone
  });

  it('still counts normally for keys hit within the window', () => {
    const store = new MemoryStore();
    const t0 = Date.now();

    expect(store.incr('hot:ip:10.0.0.8', 60_000).count).toBe(1);
    expect(store.incr('hot:ip:10.0.0.8', 60_000).count).toBe(2);

    setSystemTime(t0 + 61_000);
    expect(store.incr('hot:ip:10.0.0.8', 60_000).count).toBe(1);
    expect(store.size).toBe(1);
  });
});

describe('rate-limit warn-timestamp eviction (#847)', () => {
  it('drops warn timestamps that have aged past the throttle window', () => {
    const t0 = Date.now();
    const throttleMs = 60_000;

    expect(shouldWarnRateLimit('warn:ip:10.0.1.1', throttleMs)).toBe(true);
    expect(shouldWarnRateLimit('warn:ip:10.0.1.2', throttleMs)).toBe(true);
    expect(rateLimitWarnMapSizeForTests()).toBe(2);

    // Still inside the throttle window: no warn, no eviction.
    expect(shouldWarnRateLimit('warn:ip:10.0.1.1', throttleMs)).toBe(false);
    expect(rateLimitWarnMapSizeForTests()).toBe(2);

    setSystemTime(t0 + 61_000); // past the throttle window

    // A new warn event sweeps both stale timestamps, then records its own.
    expect(shouldWarnRateLimit('warn:ip:10.0.1.3', throttleMs)).toBe(true);
    expect(rateLimitWarnMapSizeForTests()).toBe(1);
  });

  it('throttles the warn sweep: a stale entry survives inside the interval and is removed by the next sweep', () => {
    // One timeline, keys unique to this test: the warn map is module-global.
    const t0 = Date.now();
    const throttleMs = 60_000;

    expect(shouldWarnRateLimit('sweep:ip:10.0.2.1', throttleMs)).toBe(true); // first sweep runs here
    setSystemTime(t0 + 300);
    // Recorded with a 100ms throttle; the sweep is throttled (300ms < 1s interval).
    expect(shouldWarnRateLimit('sweep:ip:10.0.2.2', 100)).toBe(true);
    setSystemTime(t0 + 500); // the 100ms entry is now stale (age 200ms)
    expect(shouldWarnRateLimit('sweep:ip:10.0.2.3', throttleMs)).toBe(true); // sweep still throttled
    expect(rateLimitWarnMapSizeForTests()).toBe(3); // stale entry survived

    setSystemTime(t0 + 1_500); // past the 1s sweep interval
    expect(shouldWarnRateLimit('sweep:ip:10.0.2.4', throttleMs)).toBe(true); // sweep runs again
    expect(rateLimitWarnMapSizeForTests()).toBe(3); // 10.0.2.2 evicted; .1, .3, .4 remain
  });
});
