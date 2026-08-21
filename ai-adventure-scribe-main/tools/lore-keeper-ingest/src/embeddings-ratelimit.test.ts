import assert from 'node:assert/strict';

import { test } from 'bun:test';

import {
  DEFAULT_RETRY_DELAY_MS,
  createItemRateLimiter,
  parseRetryDelayMs,
  postBatchWithRetry,
} from './embeddings.js';

/**
 * Pacing and 429 handling. Google counts each ITEM of a batch against the per-minute quota, so
 * a batch that is too large, or budget recorded for a request that was never served, both end
 * in a 429 storm. These drive a fake clock rather than real time.
 */

interface FakeClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  advance: (ms: number) => void;
  slept: number[];
}

/** Fake clock: time only advances when a sleep is awaited. */
function fakeClock(start = 1_000_000): FakeClock {
  let nowMs = start;
  const slept: number[] = [];
  return {
    now: () => nowMs,
    sleep: async (ms: number) => {
      slept.push(ms);
      nowMs += ms;
    },
    advance: (ms: number) => {
      nowMs += ms;
    },
    slept,
  };
}

test('rate limiter evicts items once they age out of the trailing window', () => {
  const clock = fakeClock();
  const limiter = createItemRateLimiter({
    limit: 90,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  limiter.record(50);
  assert.equal(limiter.size(), 50);

  // Still inside the window: nothing evicted.
  clock.advance(59_999);
  assert.equal(limiter.size(), 50);

  // Exactly one window later the batch has aged out.
  clock.advance(1);
  assert.equal(limiter.size(), 0);
});

test('rate limiter blocks until the oldest items age out, then admits', async () => {
  const clock = fakeClock();
  const limiter = createItemRateLimiter({
    limit: 90,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  limiter.record(50);
  // 50 + 50 = 100 > 90, so this must wait for the first 50 to expire.
  await limiter.acquire(50);

  assert.equal(clock.slept.length, 1);
  assert.ok(clock.slept[0] >= 60_000, `expected a ~window-length wait, got ${clock.slept[0]}`);
  assert.equal(limiter.size(), 0);
});

test('rate limiter admits immediately when the batch fits', async () => {
  const clock = fakeClock();
  const limiter = createItemRateLimiter({
    limit: 90,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  limiter.record(40);
  await limiter.acquire(50);
  assert.equal(clock.slept.length, 0);
});

test('a 429ed attempt reserves no budget — recorded once per call, not once per attempt', async () => {
  // Regression: reserving on every attempt double-counted a retried batch, inflating the
  // local window and causing self-inflicted waits that Google never asked for.
  const clock = fakeClock();
  // Limit far above the batch so no eviction wait can occur: under the old reserve-per-attempt
  // behaviour both reservations stay inside the window and the size is unambiguously 100. A
  // tight limit would mask the bug by forcing an evicting wait between attempts.
  const limiter = createItemRateLimiter({
    limit: 1000,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ error: { details: [{ retryDelay: '17s' }] } }), {
        status: 429,
      });
    }
    return new Response('{}', { status: 200 });
  };

  const response = await postBatchWithRetry('https://example.invalid', '{}', 50, {
    limiter,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: clock.sleep,
    onRetry: () => {},
  });

  assert.equal(response.status, 200);
  assert.equal(calls, 2);
  // 50, not 100: the rejected attempt consumed none of Google's quota.
  assert.equal(limiter.size(), 50);
  // The only sleep was the server-requested backoff — no self-inflicted throttle.
  assert.deepEqual(clock.slept, [18_000]);
});

test('postBatchWithRetry throws once 429 retries are exhausted', async () => {
  const clock = fakeClock();
  const limiter = createItemRateLimiter({
    limit: 90,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    return new Response('{"error":{"message":"quota"}}', { status: 429 });
  };

  await assert.rejects(
    () =>
      postBatchWithRetry('https://example.invalid', '{}', 10, {
        limiter,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: clock.sleep,
        maxRetries: 2,
        onRetry: () => {},
      }),
    /429 after 2 retries/,
  );

  // Attempts 0, 1, 2 — the third exhausts maxRetries.
  assert.equal(calls, 3);
  // Nothing was ever served, so nothing was recorded.
  assert.equal(limiter.size(), 0);
});

test('non-429 responses are returned as-is without retrying', async () => {
  const clock = fakeClock();
  const limiter = createItemRateLimiter({
    limit: 90,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    return new Response('boom', { status: 500 });
  };

  const response = await postBatchWithRetry('https://example.invalid', '{}', 10, {
    limiter,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: clock.sleep,
  });

  assert.equal(response.status, 500);
  assert.equal(calls, 1);
  // Only a 429 means "not served". Any other status is assumed to have consumed quota, so it
  // is recorded — erring toward over-throttling rather than a 429 storm.
  assert.equal(limiter.size(), 10);
});

test('parseRetryDelayMs reads the structured RetryInfo field', () => {
  const body = JSON.stringify({
    error: {
      details: [
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '16.643398127s' },
      ],
    },
  });
  assert.equal(parseRetryDelayMs(body), 16_644);
});

test('parseRetryDelayMs falls back to the prose form', () => {
  assert.equal(parseRetryDelayMs('Please retry in 16.6s.'), 16_600);
});

test('parseRetryDelayMs returns null when no delay is present, and the caller defaults', () => {
  assert.equal(parseRetryDelayMs('{"error":{"message":"quota exceeded"}}'), null);
  assert.equal(DEFAULT_RETRY_DELAY_MS, 30_000);
});

test('an unparsable 429 body falls back to the default retry delay', async () => {
  const clock = fakeClock();
  const limiter = createItemRateLimiter({
    limit: 90,
    windowMs: 60_000,
    now: clock.now,
    sleep: clock.sleep,
  });

  let calls = 0;
  const fetchImpl = async (): Promise<Response> => {
    calls += 1;
    return calls === 1
      ? new Response('no delay here', { status: 429 })
      : new Response('{}', { status: 200 });
  };

  const retries: number[] = [];
  await postBatchWithRetry('https://example.invalid', '{}', 10, {
    limiter,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleep: clock.sleep,
    onRetry: (ms) => retries.push(ms),
  });

  assert.deepEqual(retries, [DEFAULT_RETRY_DELAY_MS]);
});
