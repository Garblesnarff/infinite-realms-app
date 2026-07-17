/**
 * Webhook handling exercised through Elysia's Fetch entrypoint. Stripe and
 * postgres are mocked; assertions intentionally cover the claim table state
 * transitions rather than a live Stripe signature implementation.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

let constructEventAsync: (payload: string, signature: string, secret: string) => Promise<any>;
let claimResult: unknown[] = [];
let failProcessing = false;
const queries: string[] = [];

const sql = async (strings: TemplateStringsArray, ..._values: unknown[]) => {
  const query = strings.join(' ');
  queries.push(query);

  if (query.includes('INSERT INTO processed_stripe_events')) return claimResult;
  if (failProcessing && query.includes('UPDATE users')) throw new Error('database write failed');
  return [];
};

class StripeMock {
  webhooks = { constructEventAsync: (...args: [string, string, string]) => constructEventAsync(...args) };
  customers = { create: async () => ({ id: 'cus_test' }) };
  checkout = { sessions: { create: async () => ({ id: 'cs_test', url: 'https://stripe.test/session' }) } };
  billingPortal = { sessions: { create: async () => ({ url: 'https://stripe.test/portal' }) } };
}

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('stripe', () => ({ default: StripeMock }));
mock.module('../../../lib/db.js', () => ({ sql }));
mock.module('../../../lib/env.js', () => ({
  env: {
    STRIPE_SECRET_KEY: 'sk_test_mocked',
    STRIPE_WEBHOOK_SECRET: 'whsec_mocked',
    STRIPE_PRICE_ID: 'price_pro',
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));

const { billingRoutes } = await import('../billing.js');

function webhookRequest() {
  return new Request('http://localhost/v1/billing/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=mocked' },
    body: JSON.stringify({ ignored: 'because Stripe receives the raw body' }),
  });
}

const checkoutEvent = {
  id: 'evt_checkout_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_1',
      metadata: { userId: 'user_1' },
      customer: 'cus_1',
      subscription: 'sub_1',
      amount_total: 1200,
      currency: 'usd',
    },
  },
};

beforeEach(() => {
  queries.length = 0;
  claimResult = [{ event_id: 'evt_checkout_1' }];
  failProcessing = false;
  constructEventAsync = async () => checkoutEvent;
});

describe('billing webhook API boundary', () => {
  it('returns 400 for a bad signature without changing state', async () => {
    constructEventAsync = async () => {
      throw new Error('signature verification failed');
    };

    const response = await billingRoutes.handle(webhookRequest());

    expect(response.status).toBe(400);
    expect(queries).toEqual([]);
  });

  it('processes a valid event, then makes a same-id replay an idempotent no-op', async () => {
    const first = await billingRoutes.handle(webhookRequest());
    claimResult = [];
    const replay = await billingRoutes.handle(webhookRequest());

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ received: true, duplicate: true });
    expect(queries.filter((query) => query.includes('INSERT INTO processed_stripe_events'))).toHaveLength(2);
    expect(queries.filter((query) => query.includes('UPDATE users'))).toHaveLength(1);
  });

  it('releases a claimed event when processing fails so Stripe can retry it', async () => {
    failProcessing = true;

    const response = await billingRoutes.handle(webhookRequest());

    expect(response.status).toBe(500);
    expect(queries.some((query) => query.includes('DELETE FROM processed_stripe_events'))).toBe(true);
  });
});
