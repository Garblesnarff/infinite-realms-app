/**
 * Webhook handling exercised through Elysia's Fetch entrypoint. Stripe and
 * postgres are mocked; assertions intentionally cover the claim table state
 * transitions rather than a live Stripe signature implementation.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';

let constructEventAsync: (payload: string, signature: string, secret: string) => Promise<any>;
class MockRowList<T> extends Array<T> {}
let claimResult: unknown[] = new MockRowList();
let failProcessing = false;
const queries: string[] = [];
const queryValues: unknown[][] = [];
const blockedUpdates: string[] = [];
const appliedUpdates: string[] = [];
const canceledSubscriptions: string[] = [];
const retrievedCharges: string[] = [];
let cancelError: (Error & { code?: string }) | undefined;
let retrieveChargeFails = false;
let retrievedCharge: Record<string, unknown> | undefined;
let subscriptionStatus = 'active';
let subscriptionPriceId = 'price_pro';
let disputeStatus = 'needs_response';
let userStatus = 'active';
// users rows as production has them (users.stripe_customer_id / stripe_subscription_id).
const usersByCustomer: Record<
  string,
  { id: string; stripe_subscription_id: string | null; plan?: string }
> = {
  cus_1: { id: 'user_1', stripe_subscription_id: 'sub_1' },
};
// invoice id -> subscription id, as Stripe returns on invoices.retrieve (null for one-off invoices).
const invoiceSubscriptions: Record<string, string | null> = {
  in_1: 'sub_1',
  in_old: 'sub_old',
};

const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join(' ');
  queries.push(query);
  queryValues.push(values);

  if (query.includes('INSERT INTO processed_stripe_events')) return claimResult;
  if (failProcessing && query.includes('UPDATE users')) throw new Error('database write failed');
  if (query.includes('SELECT id, stripe_subscription_id FROM users')) {
    const user = usersByCustomer[String(values[0])];
    return user ? new MockRowList(user) : new MockRowList();
  }
  if (query.includes('UPDATE users')) {
    // Evaluate the guards the real SQL carries; a blocked UPDATE matches no row.
    const blocked =
      (query.includes("IS DISTINCT FROM 'disputed'") && userStatus === 'disputed') ||
      (query.includes("IS DISTINCT FROM 'refunded'") && userStatus === 'refunded') ||
      (query.includes("AND subscription_status = 'disputed'") && userStatus !== 'disputed') ||
      (query.includes('AND stripe_subscription_id = ') &&
        !values.includes(usersByCustomer.cus_1?.stripe_subscription_id)) ||
      (query.includes("plan IS DISTINCT FROM 'tester' OR stripe_subscription_id IS NOT NULL") &&
        usersByCustomer.cus_1?.plan === 'tester' &&
        !usersByCustomer.cus_1.stripe_subscription_id);
    if (blocked) {
      blockedUpdates.push(query);
      return new MockRowList();
    }
    appliedUpdates.push(query);
    if (!query.includes('RETURNING id')) return new MockRowList();
    if (query.includes('WHERE stripe_customer_id')) {
      const user = usersByCustomer[String(values.at(-1))];
      return user ? new MockRowList({ id: user.id }) : new MockRowList();
    }
    return new MockRowList({ id: String(values.find((v) => String(v).startsWith('user_'))) });
  }
  return new MockRowList();
};

class StripeMock {
  webhooks = {
    constructEventAsync: (...args: [string, string, string]) => constructEventAsync(...args),
  };
  customers = { create: async () => ({ id: 'cus_test' }) };
  checkout = {
    sessions: { create: async () => ({ id: 'cs_test', url: 'https://stripe.test/session' }) },
  };
  charges = {
    retrieve: async (id: string) => {
      retrievedCharges.push(id);
      if (retrieveChargeFails) throw new Error('stripe unavailable');
      return { ...chargeObject, id, ...retrievedCharge };
    },
  };
  disputes = {
    retrieve: async (id: string) => ({ id, object: 'dispute', status: disputeStatus }),
  };
  invoices = {
    retrieve: async (id: string) => ({
      id,
      object: 'invoice',
      subscription: invoiceSubscriptions[id],
    }),
  };
  subscriptions = {
    cancel: async (id: string) => {
      canceledSubscriptions.push(id);
      if (cancelError) throw cancelError;
      return { id, status: 'canceled' };
    },
    retrieve: async (id: string) => ({
      id,
      object: 'subscription',
      status: subscriptionStatus,
      items: { data: [{ price: { id: subscriptionPriceId } }] },
    }),
  };
  billingPortal = { sessions: { create: async () => ({ url: 'https://stripe.test/portal' }) } };
}

const warnings: Record<string, unknown>[] = [];
const logger = {
  debug: () => {},
  info: () => {},
  warn: (entry: Record<string, unknown>) => {
    warnings.push(entry);
  },
  error: () => {},
};

mock.module('stripe', () => ({ default: StripeMock }));
mock.module('../../../lib/db.js', () => ({ sql }));
mock.module('../../../lib/env.js', () => ({
  env: {
    STRIPE_SECRET_KEY: 'stripe-key-mocked',
    STRIPE_WEBHOOK_SECRET: 'whsec_mocked',
    STRIPE_PRICE_ID: 'price_pro',
  },
}));
mock.module('../../../lib/logger.js', () => ({ logger }));
mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async () => ({ user: null, error: 'Unauthorized' }),
}));

const { UserPlanCache } = await import('../../../lib/user-plan-cache.js');
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

// Stripe Charge as delivered in webhooks: customer and invoice are id strings, never expanded.
const chargeObject = {
  id: 'ch_1',
  object: 'charge',
  amount: 1200,
  amount_captured: 1200,
  amount_refunded: 1200,
  currency: 'usd',
  customer: 'cus_1',
  invoice: 'in_1',
  paid: true,
  refunded: true,
  status: 'succeeded',
};

const refundEvent = (charge: Record<string, unknown> = chargeObject) => ({
  id: 'evt_refund_1',
  object: 'event',
  type: 'charge.refunded',
  data: { object: charge },
});

// Stripe Dispute: charge is an id string.
const disputeEvent = (type: string, status: string) => ({
  id: `evt_${type}_1`,
  object: 'event',
  type,
  data: {
    object: {
      id: 'dp_1',
      object: 'dispute',
      amount: 1200,
      charge: 'ch_1',
      currency: 'usd',
      reason: 'fraudulent',
      status,
    },
  },
});

const subscriptionUpdatedEvent = {
  id: 'evt_sub_updated_1',
  object: 'event',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_1',
      object: 'subscription',
      customer: 'cus_1',
      status: 'active',
      items: { data: [{ price: { id: 'price_pro' } }] },
    },
  },
};

const paymentFailedEvent = {
  id: 'evt_pay_failed_1',
  object: 'event',
  type: 'invoice.payment_failed',
  data: {
    object: { id: 'in_1', object: 'invoice', customer: 'cus_1', amount_due: 1200, currency: 'usd' },
  },
};

const userUpdates = () => queries.filter((q) => q.includes('UPDATE users'));
const lastUpdateValues = () =>
  queryValues[queries.findLastIndex((q) => q.includes('UPDATE users'))];

beforeEach(() => {
  queries.length = 0;
  queryValues.length = 0;
  blockedUpdates.length = 0;
  appliedUpdates.length = 0;
  warnings.length = 0;
  canceledSubscriptions.length = 0;
  retrievedCharges.length = 0;
  cancelError = undefined;
  retrieveChargeFails = false;
  retrievedCharge = undefined;
  subscriptionStatus = 'active';
  subscriptionPriceId = 'price_pro';
  disputeStatus = 'needs_response';
  userStatus = 'active';
  usersByCustomer.cus_1 = { id: 'user_1', stripe_subscription_id: 'sub_1' };
  UserPlanCache.clear();
  claimResult = new MockRowList({ event_id: 'evt_checkout_1' });
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
    expect(
      queries.filter((query) => query.includes('INSERT INTO processed_stripe_events')),
    ).toHaveLength(2);
    expect(queries.filter((query) => query.includes('UPDATE users'))).toHaveLength(1);
  });

  it('releases a claimed event when processing fails so Stripe can retry it', async () => {
    failProcessing = true;

    const response = await billingRoutes.handle(webhookRequest());

    expect(response.status).toBe(500);
    expect(queries.some((query) => query.includes('DELETE FROM processed_stripe_events'))).toBe(
      true,
    );
  });

  it('drops the cached plan when a checkout completes', async () => {
    UserPlanCache.set('user_1', 'free');

    await billingRoutes.handle(webhookRequest());

    expect(UserPlanCache.get('user_1')).toBeNull();
  });

  describe('charge.refunded', () => {
    it('cancels the current subscription, downgrades, and drops the cached plan', async () => {
      UserPlanCache.set('user_1', 'pro');
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(canceledSubscriptions).toEqual(['sub_1']);
      expect(userUpdates()).toHaveLength(1);
      expect(userUpdates()[0]).toContain("plan = 'free'");
      expect(lastUpdateValues()).toEqual(['refunded', 'user_1', 'sub_1']);
      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('trusts the retrieved charge, not the webhook payload, for refunded', async () => {
      constructEventAsync = async () => refundEvent({ ...chargeObject, refunded: false });

      await billingRoutes.handle(webhookRequest());

      expect(canceledSubscriptions).toEqual(['sub_1']);
      expect(lastUpdateValues()).toEqual(['refunded', 'user_1', 'sub_1']);
    });

    it('warns when the customer has a subscription but the charge has no invoice link', async () => {
      retrievedCharge = { invoice: null };
      constructEventAsync = async () => refundEvent();

      await billingRoutes.handle(webhookRequest());

      expect(warnings.some((w) => w.msg === 'STRIPE_CHARGE_NO_INVOICE_LINK')).toBe(true);
      expect(canceledSubscriptions).toEqual([]);
    });

    it('looks the user up by the charge customer id', async () => {
      constructEventAsync = async () => refundEvent();

      await billingRoutes.handle(webhookRequest());

      const select = queries.findIndex((q) => q.includes('SELECT id, stripe_subscription_id'));
      expect(queryValues[select]).toEqual(['cus_1']);
    });

    it('does nothing on a partial refund', async () => {
      UserPlanCache.set('user_1', 'pro');
      retrievedCharge = { amount_refunded: 300, refunded: false };
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
      expect(UserPlanCache.get('user_1')).toBe('pro');
    });

    it('only logs when the charge belongs to an earlier subscription', async () => {
      UserPlanCache.set('user_1', 'pro');
      retrievedCharge = { invoice: 'in_old' };
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
      expect(UserPlanCache.get('user_1')).toBe('pro');
    });

    it('only logs when the charge has no invoice (one-off payment)', async () => {
      retrievedCharge = { invoice: null };
      constructEventAsync = async () => refundEvent();

      await billingRoutes.handle(webhookRequest());

      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
    });

    it('does not fail when the subscription is already canceled', async () => {
      cancelError = Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(lastUpdateValues()).toEqual(['refunded', 'user_1', 'sub_1']);
    });

    it('does not fail when cancel errors with another code but Stripe says the subscription is canceled', async () => {
      cancelError = Object.assign(new Error('already canceled'), { code: 'invalid_request' });
      subscriptionStatus = 'canceled';
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(lastUpdateValues()).toEqual(['refunded', 'user_1', 'sub_1']);
    });

    it('returns 500 and releases the claim when cancel fails for another reason', async () => {
      cancelError = Object.assign(new Error('rate limited'), { code: 'rate_limit' });
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(500);
      expect(userUpdates()).toHaveLength(0);
      expect(queries.some((q) => q.includes('DELETE FROM processed_stripe_events'))).toBe(true);
    });

    it('ignores a replayed event', async () => {
      UserPlanCache.set('user_1', 'pro');
      claimResult = [];
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(await response.json()).toEqual({ received: true, duplicate: true });
      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
      expect(UserPlanCache.get('user_1')).toBe('pro');
    });

    it('skips a charge with no customer', async () => {
      retrievedCharge = { customer: null };
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
    });

    it('changes nothing for a customer with no user row', async () => {
      UserPlanCache.set('user_1', 'pro');
      retrievedCharge = { customer: 'cus_unknown' };
      constructEventAsync = async () => refundEvent();

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
      expect(UserPlanCache.get('user_1')).toBe('pro');
    });
  });

  describe('disputes', () => {
    it('a renewal customer.subscription.updated cannot lift an open dispute', async () => {
      constructEventAsync = async () => subscriptionUpdatedEvent;

      userStatus = 'disputed';
      UserPlanCache.set('user_1', 'free');

      await billingRoutes.handle(webhookRequest());

      expect(userUpdates()[0]).toContain("subscription_status IS DISTINCT FROM 'disputed'");
      expect(UserPlanCache.get('user_1')).toBe('free');
    });

    it('a renewal customer.subscription.updated still upgrades a user who is not disputed', async () => {
      UserPlanCache.set('user_1', 'free');
      constructEventAsync = async () => subscriptionUpdatedEvent;

      await billingRoutes.handle(webhookRequest());

      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('invoice.payment_failed does not overwrite a disputed or refunded status', async () => {
      constructEventAsync = async () => paymentFailedEvent;
      for (const status of ['disputed', 'refunded']) {
        userStatus = status;
        blockedUpdates.length = 0;
        appliedUpdates.length = 0;

        await billingRoutes.handle(webhookRequest());

        expect(blockedUpdates).toHaveLength(1);
        expect(appliedUpdates).toHaveLength(0);
      }
    });

    it('invoice.payment_failed still marks an active user past_due', async () => {
      constructEventAsync = async () => paymentFailedEvent;

      await billingRoutes.handle(webhookRequest());

      expect(appliedUpdates).toHaveLength(1);
      expect(blockedUpdates).toHaveLength(0);
    });

    it('subscription.deleted keeps a refunded/disputed status instead of overwriting it', async () => {
      constructEventAsync = async () => ({
        id: 'evt_sub_deleted_1',
        object: 'event',
        type: 'customer.subscription.deleted',
        data: {
          object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'canceled' },
        },
      });

      await billingRoutes.handle(webhookRequest());

      expect(userUpdates()[0]).toContain("WHEN subscription_status = 'refunded' THEN 'refunded'");
      expect(userUpdates()[0]).toContain(
        "WHEN subscription_status = 'disputed' AND stripe_subscription_id IS NULL THEN 'disputed'",
      );
    });

    it('created: downgrades, keeps the subscription on file, resolves the charge from the dispute', async () => {
      UserPlanCache.set('user_1', 'pro');
      constructEventAsync = async () => disputeEvent('charge.dispute.created', 'needs_response');

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(retrievedCharges).toEqual(['ch_1']);
      expect(canceledSubscriptions).toEqual([]);
      expect(userUpdates()[0]).toContain("plan = 'free'");
      expect(userUpdates()[0]).not.toContain('stripe_subscription_id = NULL');
      expect(lastUpdateValues()).toEqual(['user_1', 'sub_1']);
      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('created: only logs when the charge belongs to an earlier subscription', async () => {
      retrievedCharge = { invoice: 'in_old' };
      constructEventAsync = async () => disputeEvent('charge.dispute.created', 'needs_response');

      await billingRoutes.handle(webhookRequest());

      expect(userUpdates()).toHaveLength(0);
    });

    it('created: ignores a replayed event without calling Stripe', async () => {
      claimResult = [];
      constructEventAsync = async () => disputeEvent('charge.dispute.created', 'needs_response');

      const response = await billingRoutes.handle(webhookRequest());

      expect(await response.json()).toEqual({ received: true, duplicate: true });
      expect(retrievedCharges).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
    });

    it('created: skips a charge with no customer', async () => {
      retrievedCharge = { customer: null };
      constructEventAsync = async () => disputeEvent('charge.dispute.created', 'needs_response');

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(userUpdates()).toHaveLength(0);
    });

    it('created: returns 500 and releases the claim when the charge lookup throws', async () => {
      retrieveChargeFails = true;
      constructEventAsync = async () => disputeEvent('charge.dispute.created', 'needs_response');

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(500);
      expect(userUpdates()).toHaveLength(0);
      expect(queries.some((q) => q.includes('DELETE FROM processed_stripe_events'))).toBe(true);
    });

    it('closed won: restores the plan when the subscription is still active', async () => {
      userStatus = 'disputed';
      UserPlanCache.set('user_1', 'free');
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'won');

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(lastUpdateValues()).toEqual(['pro', 'active', 'user_1', 'sub_1']);
      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('closed won: subscription no longer active ends the hold with Stripe status, on free', async () => {
      userStatus = 'disputed';
      UserPlanCache.set('user_1', 'free');
      subscriptionStatus = 'canceled';
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'won');

      await billingRoutes.handle(webhookRequest());

      expect(userUpdates()).toHaveLength(1);
      expect(lastUpdateValues()).toEqual(['free', 'canceled', 'user_1', 'sub_1']);
      expect(UserPlanCache.get('user_1')).toBeNull();
      expect(warnings.some((w) => w.msg === 'DISPUTE_WON_SUBSCRIPTION_INACTIVE')).toBe(true);
    });

    it('closed lost: cancels the subscription and stays on free', async () => {
      UserPlanCache.set('user_1', 'free');
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'lost');

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(canceledSubscriptions).toEqual(['sub_1']);
      expect(userUpdates()[0]).toContain("plan = 'free'");
      expect(lastUpdateValues()).toEqual(['disputed', 'user_1', 'sub_1']);
      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('closed warning_closed (inquiry) restores like a win', async () => {
      userStatus = 'disputed';
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'warning_closed');

      await billingRoutes.handle(webhookRequest());

      expect(lastUpdateValues()).toEqual(['pro', 'active', 'user_1', 'sub_1']);
    });

    it('closed won: does not touch a user who is not marked disputed (out-of-order or replay)', async () => {
      UserPlanCache.set('user_1', 'pro');
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'won');

      await billingRoutes.handle(webhookRequest());

      expect(UserPlanCache.get('user_1')).toBe('pro');
    });

    it('closed won: unknown price id ends the hold on free, so renewals can set the plan', async () => {
      userStatus = 'disputed';
      UserPlanCache.set('user_1', 'free');
      subscriptionPriceId = 'price_unknown';
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'won');

      await billingRoutes.handle(webhookRequest());

      expect(userUpdates()).toHaveLength(1);
      expect(lastUpdateValues()).toEqual(['free', 'active', 'user_1', 'sub_1']);
      expect(UserPlanCache.get('user_1')).toBeNull();
      expect(warnings.some((w) => w.msg === 'DISPUTE_WON_UNKNOWN_PRICE')).toBe(true);
    });

    it('created: an inquiry (warning_*) does not downgrade', async () => {
      disputeStatus = 'warning_needs_response';
      constructEventAsync = async () =>
        disputeEvent('charge.dispute.created', 'warning_needs_response');

      const response = await billingRoutes.handle(webhookRequest());

      expect(response.status).toBe(200);
      expect(userUpdates()).toHaveLength(0);
    });

    it('created arriving after the dispute already closed does not downgrade', async () => {
      disputeStatus = 'won';
      constructEventAsync = async () => disputeEvent('charge.dispute.created', 'needs_response');

      await billingRoutes.handle(webhookRequest());

      expect(userUpdates()).toHaveLength(0);
    });

    it('closed with another status: no action', async () => {
      constructEventAsync = async () => disputeEvent('charge.dispute.closed', 'charge_refunded');

      await billingRoutes.handle(webhookRequest());

      expect(retrievedCharges).toEqual([]);
      expect(userUpdates()).toHaveLength(0);
    });
  });

  // #2474: a tester row is set by hand. It has no subscription on file, but it can carry a
  // stripe_customer_id if the account ever opened checkout. Events and users.* follow the
  // shapes above (Stripe objects as delivered, users row as production has it).
  describe('tester plan (#2474)', () => {
    const subscriptionDeletedEvent = {
      id: 'evt_sub_deleted_tester',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: {
        object: { id: 'sub_1', object: 'subscription', customer: 'cus_1', status: 'canceled' },
      },
    };
    const testerEvents: [string, () => unknown][] = [
      ['customer.subscription.updated', () => subscriptionUpdatedEvent],
      ['customer.subscription.deleted', () => subscriptionDeletedEvent],
      ['charge.refunded', () => refundEvent()],
      ['charge.dispute.created', () => disputeEvent('charge.dispute.created', 'needs_response')],
      ['charge.dispute.closed won', () => disputeEvent('charge.dispute.closed', 'won')],
      ['charge.dispute.closed lost', () => disputeEvent('charge.dispute.closed', 'lost')],
    ];

    beforeEach(() => {
      usersByCustomer.cus_1 = { id: 'user_1', plan: 'tester', stripe_subscription_id: null };
      UserPlanCache.set('user_1', 'tester');
    });

    it.each(testerEvents)(
      '%s leaves a tester row with no subscription on file untouched',
      async (_name, event) => {
        constructEventAsync = async () => event();

        const response = await billingRoutes.handle(webhookRequest());

        expect(response.status).toBe(200);
        expect(appliedUpdates).toHaveLength(0);
        expect(canceledSubscriptions).toEqual([]);
        expect(UserPlanCache.get('user_1')).toBe('tester');
      },
    );

    it('customer.subscription.updated still changes a tester who has a subscription on file', async () => {
      usersByCustomer.cus_1 = { id: 'user_1', plan: 'tester', stripe_subscription_id: 'sub_1' };
      userStatus = 'active';
      constructEventAsync = async () => subscriptionUpdatedEvent;

      await billingRoutes.handle(webhookRequest());

      expect(appliedUpdates).toHaveLength(1);
      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('customer.subscription.deleted still downgrades a tester who has a subscription on file', async () => {
      usersByCustomer.cus_1 = { id: 'user_1', plan: 'tester', stripe_subscription_id: 'sub_1' };
      userStatus = 'active';
      constructEventAsync = async () => subscriptionDeletedEvent;

      await billingRoutes.handle(webhookRequest());

      expect(appliedUpdates).toHaveLength(1);
      expect(UserPlanCache.get('user_1')).toBeNull();
    });

    it('a free user with a customer id is still updated by customer.subscription.updated', async () => {
      usersByCustomer.cus_1 = { id: 'user_1', plan: 'free', stripe_subscription_id: null };
      userStatus = 'active';
      constructEventAsync = async () => subscriptionUpdatedEvent;

      await billingRoutes.handle(webhookRequest());

      expect(appliedUpdates).toHaveLength(1);
    });
  });
});
