/**
 * #350: when the provider chain is exhausted by a key/credit limit, the
 * service logs LLM_PROVIDER_KEY_LIMIT and fires the ops alert path once per
 * 15 minutes. The provider is stubbed at the fetch layer (no live DM calls);
 * the real LLMProviderService runs.
 *
 * The alerting module itself is spied (not the real webhook POST): the real
 * module's per-kind rate limiting is covered by lib/__tests__/alerting.test.ts
 * ("honours a caller-supplied windowMs"), and spying keeps this file immune
 * to llm-failover-log.test.ts's process-global alerting mock.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

type LogEntry = Record<string, unknown>;

const errorLogs: LogEntry[] = [];
const alertCalls: Array<{ kind: string; detail: unknown; opts: unknown }> = [];
const testLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: (entry: unknown) => {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      errorLogs.push(entry as LogEntry);
    }
  },
  child: () => testLogger,
};

mock.module('../../lib/logger.js', () => ({
  logger: testLogger,
  combatLogger: testLogger,
  spellLogger: testLogger,
  progressionLogger: testLogger,
  errorLogSerializers: {},
  default: testLogger,
}));
mock.module('../../lib/alerting.js', () => ({
  alert: (kind: string, detail: unknown, opts: unknown) => {
    alertCalls.push({ kind, detail, opts });
  },
}));

// The real service and the real key-limit module; only alert() is spied.
const { LLMProviderService } = await import('../llm-provider-service.js');
const { resetCircuitBreakersForTests } = await import('../../utils/circuit-breaker.js');
const { resetProviderKeyLimitForTests } = await import('../llm-provider-service.js');
const { isProviderKeyLimitError, KEY_LIMIT_ALERT_KIND, alertProviderKeyLimit, KEY_LIMIT_ALERT_WINDOW_MS } =
  await import('../llm-key-limit.js');

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  errorLogs.length = 0;
  alertCalls.length = 0;
  process.env.OPENROUTER_API_KEY = 'test-key';
  process.env.OPENROUTER_TEXT_MODEL = 'primary/model';
  process.env.OPENROUTER_FALLBACK_MODELS = 'secondary/model,tertiary/model';
  // Keep the circuit closed across all N turns so every turn really exhausts
  // the chain (the default threshold of 3 would open it mid-test).
  process.env.CB_FAILURE_THRESHOLD = '100';
  delete process.env.SLACK_ALERT_WEBHOOK_URL;
  resetCircuitBreakersForTests();
  resetProviderKeyLimitForTests();
  // The stubbed provider: every model in the chain 403s with the spend-cap message.
  globalThis.fetch = (async () =>
    new Response('Key limit exceeded', { status: 403 })) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env = { ...originalEnv };
  resetCircuitBreakersForTests();
  resetProviderKeyLimitForTests();
});

describe('isProviderKeyLimitError', () => {
  it('matches upstream auth/limit statuses', () => {
    expect(isProviderKeyLimitError({ upstreamStatus: 401 })).toBe(true);
    expect(isProviderKeyLimitError({ upstreamStatus: 402 })).toBe(true);
    expect(isProviderKeyLimitError({ upstreamStatus: 403 })).toBe(true);
  });

  it('does not match other statuses', () => {
    expect(isProviderKeyLimitError({ upstreamStatus: 429 })).toBe(false);
    expect(isProviderKeyLimitError({ upstreamStatus: 500 })).toBe(false);
    expect(isProviderKeyLimitError({ upstreamStatus: 400 })).toBe(false);
    expect(isProviderKeyLimitError({})).toBe(false);
    expect(isProviderKeyLimitError({ upstreamStatus: null, details: null })).toBe(false);
  });

  it('matches limit/credit messages on non-429, non-5xx statuses (#350 FIX round 2)', () => {
    expect(isProviderKeyLimitError({ details: 'Key limit exceeded' })).toBe(true);
    expect(
      isProviderKeyLimitError({ upstreamStatus: 403, details: 'Key limit exceeded' }),
    ).toBe(true);
    // A 5xx gates the message pattern: 5xx bodies are upstream HTML/error pages
    // or local validation text, never a dead key.
    expect(
      isProviderKeyLimitError({ upstreamStatus: 500, details: 'credits exhausted for today' }),
    ).toBe(false);
    expect(isProviderKeyLimitError({ upstreamStatus: 500, details: 'boom' })).toBe(false);
  });

  it('never matches a 429 rate-limit message (#350 FIX round 2)', () => {
    // "Rate limit exceeded" contains "limit" but is a slowdown, not a dead key.
    expect(
      isProviderKeyLimitError({ upstreamStatus: 429, details: 'Rate limit exceeded' }),
    ).toBe(false);
    expect(
      isProviderKeyLimitError({
        upstreamStatus: 429,
        details: 'Quota exceeded for quota metric, limit: 100',
      }),
    ).toBe(false);
  });

  it('never matches local validation text containing "limit" (#350 FIX round 2)', () => {
    // Structured-validation failures are synthesized as status 502 with the
    // local validation message; they must never mark the chain as key-limit.
    expect(
      isProviderKeyLimitError({
        upstreamStatus: 502,
        details:
          'Structured response is not valid JSON: Unexpected token l in JSON at position 0 ("limit": 5)',
      }),
    ).toBe(false);
  });
});

describe('alertProviderKeyLimit', () => {
  it('pages through the ops alert path with the 15-minute window (#350 nit)', () => {
    expect(KEY_LIMIT_ALERT_WINDOW_MS).toBe(15 * 60 * 1000);
    alertProviderKeyLimit({ provider: 'openrouter', upstreamStatus: 403 });

    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].kind).toBe(KEY_LIMIT_ALERT_KIND);
    expect(alertCalls[0].opts).toEqual({ windowMs: 15 * 60 * 1000 });
    const detail = JSON.stringify(alertCalls[0].detail);
    expect(detail).toContain('openrouter');
    expect(detail).toContain('403');
  });
});

describe('provider key-limit alerting (#350)', () => {
  it('fires the key-limit alert on every chain-exhausted turn, with the 15-minute window', async () => {
    const results = [];
    for (let i = 0; i < 5; i++) {
      results.push(await LLMProviderService.generate({ prompt: 'hello', provider: 'openrouter' }));
    }

    // Every turn degraded with the real chain-exhausted shape (the fixture the
    // route test mirrors), carrying the single computed key-limit verdict.
    for (const result of results) {
      expect(result.error).toBe('LLM request failed');
      expect(result.provider).toBe('openrouter');
      expect(result.upstreamStatus).toBe(403);
      expect(result.providerKeyLimit).toBe(true);
      expect(result.text).toBe('');
    }

    // The distinct code is logged on every exhausted chain…
    expect(errorLogs.filter((entry) => entry.msg === 'LLM_PROVIDER_KEY_LIMIT')).toHaveLength(5);
    // …and the ops alert path fires for each, with the 15-minute window that
    // the real alerting module turns into exactly one page per window
    // (lib/__tests__/alerting.test.ts covers the windowing itself).
    expect(alertCalls).toHaveLength(5);
    for (const call of alertCalls) {
      expect(call.kind).toBe(KEY_LIMIT_ALERT_KIND);
      expect(call.opts).toEqual({ windowMs: 15 * 60 * 1000 });
    }
    // No key values, no user data: provider name and status only.
    for (const call of alertCalls) {
      expect(JSON.stringify(call.detail)).not.toContain('test-key');
      expect(JSON.stringify(call.detail)).toContain('openrouter');
    }
  });

  it('does not alert when the chain fails with a non-limit error', async () => {
    globalThis.fetch = (async () =>
      new Response('upstream exploded', { status: 500 })) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({ prompt: 'hello', provider: 'openrouter' });

    expect(result.upstreamStatus).toBe(500);
    expect(result.providerKeyLimit).toBe(false);
    expect(errorLogs.filter((entry) => entry.msg === 'LLM_PROVIDER_KEY_LIMIT')).toHaveLength(0);
    expect(alertCalls).toHaveLength(0);
  });

  it('does not treat a 429 rate-limit chain as a dead key (#350 FIX round 2)', async () => {
    // Every model in the chain 429s with a "limit"-shaped message. The message
    // pattern matches, but 429 is rate limiting, not a dead key: no page, no
    // maintenance message signal, no quota refund signal.
    globalThis.fetch = (async () =>
      new Response('Rate limit exceeded', { status: 429 })) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({ prompt: 'hello', provider: 'openrouter' });

    expect(result.upstreamStatus).toBe(429);
    expect(result.providerKeyLimit).toBe(false);
    expect(errorLogs.filter((entry) => entry.msg === 'LLM_PROVIDER_KEY_LIMIT')).toHaveLength(0);
    expect(alertCalls).toHaveLength(0);
  });

  it('does not treat structured-validation failures as a dead key (#350 FIX round 2)', async () => {
    // A 200 whose body fails structured validation is synthesized as a 502
    // with the local validation message — even when the model text contains
    // "limit", the chain must not be marked key-limit.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"limit": 5, "oops": true}' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({
      prompt: 'hello',
      provider: 'openrouter',
      responseSchema: { type: 'object', properties: { text: { type: 'string' } } },
    });

    expect(result.providerKeyLimit).toBe(false);
    expect(errorLogs.filter((entry) => entry.msg === 'LLM_PROVIDER_KEY_LIMIT')).toHaveLength(0);
    expect(alertCalls).toHaveLength(0);
  });

  it('treats the chain as key-limit when any attempt is key-limit-shaped (#350 N2)', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      // First model 403s with the spend-cap message; the rest fail differently.
      return calls === 1
        ? new Response('Key limit exceeded', { status: 403 })
        : new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;

    const result = await LLMProviderService.generate({ prompt: 'hello', provider: 'openrouter' });

    // The last failure was a 500, but the first 403 proved the key dead.
    expect(result.upstreamStatus).toBe(500);
    expect(result.providerKeyLimit).toBe(true);
    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].kind).toBe(KEY_LIMIT_ALERT_KIND);
  });

  it('carries the key-limit signal through the breaker-open fast fail (#350 B1)', async () => {
    // Production default: the breaker opens after 3 consecutive failures.
    // (The other tests pin CB_FAILURE_THRESHOLD=100 precisely to dodge this.)
    delete process.env.CB_FAILURE_THRESHOLD;
    resetCircuitBreakersForTests();
    resetProviderKeyLimitForTests();

    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await LLMProviderService.generate({ prompt: 'hello', provider: 'openrouter' }));
    }

    // The first three turns exhaust the chain…
    for (const result of results.slice(0, 3)) {
      expect(result.upstreamStatus).toBe(403);
      expect(result.providerKeyLimit).toBe(true);
    }
    // …then the breaker opens. The fourth turn fails fast, but it still
    // carries the key-limit signal so the route shows the maintenance message
    // and refunds the quota unit instead of the generic failure.
    const fastFail = results[3];
    expect(fastFail.error).toBe('Provider temporarily unavailable');
    expect(fastFail.status).toBe(503);
    expect(fastFail.providerKeyLimit).toBe(true);
    expect(fastFail.upstreamStatus).toBe(403);
    // The alert fired on the chain-exhausted turns (the real alerting module
    // windows those to one page per 15 minutes).
    expect(alertCalls.length).toBeGreaterThan(0);
    expect(alertCalls[0].kind).toBe(KEY_LIMIT_ALERT_KIND);
  });
});
