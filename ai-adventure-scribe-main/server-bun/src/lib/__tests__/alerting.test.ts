import { describe, expect, it, mock, beforeEach, afterEach } from 'bun:test';

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

mock.module('../logger.js', () => ({ logger: noopLogger }));

const { alert } = await import('../alerting.js');

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

  it('always logs a structured [ALERT] line, even with no webhook configured', () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;

    alert('narrative_fact_write_failed', { sessionId: 'sess-1', error: 'boom' });

    expect(warnCalls).toHaveLength(1);
    expect(warnCalls[0]).toBe(
      '[ALERT] kind=narrative_fact_write_failed session=sess-1 error=boom',
    );
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
