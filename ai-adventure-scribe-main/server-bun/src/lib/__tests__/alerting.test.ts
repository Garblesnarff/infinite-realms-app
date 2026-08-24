import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';

import { alert, logAlertingConfiguration } from '../alerting.js';
import { logger } from '../logger.js';

const warnCalls: unknown[] = [];
let warnShouldThrow = false;
const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: (...args: unknown[]) => {
    if (warnShouldThrow) throw new Error('logger exploded');
    warnCalls.push(args[0]);
  },
  error: () => {},
};

const warnSpy = spyOn(logger, 'warn').mockImplementation(noopLogger.warn);

describe('alert()', () => {
  const originalFetch = globalThis.fetch;
  const originalWebhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  const originalDateNow = Date.now;

  let fetchCalls: Array<{ url: string; body: unknown }>;
  let mockTime: number;

  beforeEach(() => {
    warnCalls.length = 0;
    fetchCalls = [];
    mockTime = 1_700_000_000_000;
    Date.now = () => mockTime;
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Date.now = originalDateNow;
    if (originalWebhookUrl === undefined) {
      delete process.env.SLACK_ALERT_WEBHOOK_URL;
    } else {
      process.env.SLACK_ALERT_WEBHOOK_URL = originalWebhookUrl;
    }
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('always logs a structured [ALERT] line, even with no webhook configured', () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;

    alert('narrative_fact_write_failed', { sessionId: 'sess-1', error: 'boom' });

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe('[ALERT] kind=narrative_fact_write_failed session=sess-1 error=boom');
  });

  it('does not POST to a webhook when SLACK_ALERT_WEBHOOK_URL is unset', () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;

    alert('scene_state_render_failed', {});

    expect(fetchCalls).toHaveLength(0);
  });

  it('POSTs a compact Slack-webhook-format message when the env var is set', () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example.test/webhook';

    alert('lore_injection_failed', { sessionId: 'sess-2', error: 'timeout' });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]!.url).toBe('https://hooks.example.test/webhook');
    expect(fetchCalls[0]!.body).toEqual({
      text: '[ALERT] kind=lore_injection_failed session=sess-2 error=timeout',
    });
  });

  it('rate-limits webhook POSTs to at most one per kind per 60s, without rate-limiting logs', () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example.test/webhook';

    alert('combat_ended_unresolved', { sessionId: 's' });
    alert('combat_ended_unresolved', { sessionId: 's' });
    alert('combat_ended_unresolved', { sessionId: 's' });

    expect(fetchCalls).toHaveLength(1);
    expect(warnCalls).toHaveLength(3);

    // A different kind is not affected by another kind's rate limit.
    alert('scene_state_fetch_failed', { sessionId: 's' });
    expect(fetchCalls).toHaveLength(2);

    // After the window elapses, the same kind can post again.
    mockTime += 60_001;
    alert('combat_ended_unresolved', { sessionId: 's' });
    expect(fetchCalls).toHaveLength(3);
  });

  it('never throws when the webhook fetch rejects', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example.test/webhook';
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as typeof fetch;

    expect(() => alert('narrative_fact_write_failed', { error: 'x' })).not.toThrow();

    // Let the rejected promise's .catch() handler run so it doesn't surface as an
    // unhandled rejection in the test process.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('never throws even if the logger itself throws', () => {
    warnShouldThrow = true;
    try {
      expect(() => alert('narrative_fact_write_failed', { error: 'x' })).not.toThrow();
    } finally {
      warnShouldThrow = false;
    }
  });
});

describe('logAlertingConfiguration()', () => {
  const originalWebhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
  const infoCalls: unknown[] = [];
  const localWarnCalls: unknown[] = [];
  let localWarnShouldThrow = false;

  // The outer describe restores its own warn spy in afterAll, which runs before this
  // block's tests, so the spies are installed per-test rather than once at describe time.
  let infoSpy: ReturnType<typeof spyOn>;
  let localWarnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    localWarnCalls.length = 0;
    infoCalls.length = 0;
    infoSpy = spyOn(logger, 'info').mockImplementation((...args: unknown[]) => {
      infoCalls.push(args[0]);
    });
    localWarnSpy = spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
      if (localWarnShouldThrow) throw new Error('logger exploded');
      localWarnCalls.push(args[0]);
    });
  });

  afterEach(() => {
    if (originalWebhookUrl === undefined) {
      delete process.env.SLACK_ALERT_WEBHOOK_URL;
    } else {
      process.env.SLACK_ALERT_WEBHOOK_URL = originalWebhookUrl;
    }
    infoSpy.mockRestore();
    localWarnSpy.mockRestore();
  });

  it('logs a configured line at info when the webhook URL is set', () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.example.test/webhook';

    logAlertingConfiguration();

    expect(infoCalls).toEqual([{ msg: 'Slack alerting: configured' }]);
    expect(localWarnCalls).toHaveLength(0);
  });

  it('warns loudly when the webhook URL is missing', () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;

    logAlertingConfiguration();

    expect(localWarnCalls).toEqual([{ msg: 'Slack alerting: DISABLED (no webhook URL)' }]);
    expect(infoCalls).toHaveLength(0);
  });

  it('treats an empty webhook URL as disabled', () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = '';

    logAlertingConfiguration();

    expect(localWarnCalls).toEqual([{ msg: 'Slack alerting: DISABLED (no webhook URL)' }]);
  });

  it('never throws even if the logger throws', () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    localWarnShouldThrow = true;
    try {
      expect(() => logAlertingConfiguration()).not.toThrow();
    } finally {
      localWarnShouldThrow = false;
    }
  });
});
