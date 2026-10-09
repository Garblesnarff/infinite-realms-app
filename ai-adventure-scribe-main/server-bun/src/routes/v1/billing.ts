/**
 * Billing Routes for Elysia
 *
 * Provides Stripe subscription management API endpoints:
 * - POST /v1/billing/create-checkout-session - Create Stripe Checkout session
 * - POST /v1/billing/webhook - Handle Stripe webhooks
 * - GET /v1/billing/subscription - Get current subscription status
 * - POST /v1/billing/portal-session - Create Stripe Customer Portal session
 *
 * Ported from /server/src/routes/v1/billing.ts
 */

import { Elysia, t } from 'elysia';
import Stripe from 'stripe';

import { sql } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';
import { UserPlanCache } from '../../lib/user-plan-cache.js';
import { authedUser } from '../../middleware/authed-user.js';
import {
  claimStripeEvent,
  getPlanFromPriceId,
  resolveAllowedPriceId,
  validateCheckoutUrl,
} from '../../services/stripe-checkout-security.js';

// Initialize Stripe client (lazy - only if key is configured)
let stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY not configured');
    }
    stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
    });
  }
  return stripe;
}

// auth.ts caches the plan per user for 5 minutes; drop it whenever the webhook writes users.plan.
function invalidatePlanCache(rows: readonly Record<string, unknown>[]): void {
  for (const row of rows) UserPlanCache.delete(String(row.id));
}

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  typeof ref === 'string' ? ref : (ref?.id ?? null);

/**
 * Find the user whose CURRENT subscription the charge paid for (charge.invoice -> invoice.subscription
 * must equal users.stripe_subscription_id). Anything else is logged and ignored. The charge is re-read
 * with the pinned client before calling this: webhook payload shape follows the endpoint's API version.
 */
async function resolveChargeOwner(
  stripeClient: Stripe,
  charge: Stripe.Charge,
  eventId: string,
): Promise<{ userId: string; subscriptionId: string } | null> {
  const chargeId = charge.id;
  const customerId = idOf(charge.customer);
  if (!customerId) {
    logger.error({ msg: 'STRIPE_CHARGE_CUSTOMER_UNRESOLVED', alert: true, eventId, chargeId });
    return null;
  }

  const invoice =
    typeof charge.invoice === 'string'
      ? await stripeClient.invoices.retrieve(charge.invoice)
      : charge.invoice;
  const chargeSubscriptionId = idOf(invoice?.subscription);

  const rows =
    await sql`SELECT id, stripe_subscription_id FROM users WHERE stripe_customer_id = ${customerId} LIMIT 1`;
  const user = rows[0];
  if (!user) {
    logger.warn({ msg: 'STRIPE_CHARGE_USER_NOT_FOUND', eventId, chargeId, customerId });
    return null;
  }
  if (!chargeSubscriptionId) {
    if (user.stripe_subscription_id) {
      logger.warn({
        msg: 'STRIPE_CHARGE_NO_INVOICE_LINK',
        eventId,
        chargeId,
        userId: String(user.id),
      });
    }
    return null;
  }
  if (chargeSubscriptionId !== user.stripe_subscription_id) {
    logger.info({
      msg: 'STRIPE_CHARGE_NOT_CURRENT_SUBSCRIPTION',
      eventId,
      chargeId,
      userId: String(user.id),
    });
    return null;
  }
  return { userId: String(user.id), subscriptionId: chargeSubscriptionId };
}

// Cancel now (no period-end renewal). An already-canceled subscription is not an error.
async function cancelSubscription(stripeClient: Stripe, subscriptionId: string): Promise<void> {
  try {
    await stripeClient.subscriptions.cancel(subscriptionId);
  } catch (err) {
    const alreadyCanceled =
      (err as { code?: string }).code === 'resource_missing' ||
      (await stripeClient.subscriptions.retrieve(subscriptionId).catch(() => null))?.status ===
        'canceled';
    if (!alreadyCanceled) throw err;
    logger.info({ msg: 'STRIPE_SUBSCRIPTION_ALREADY_CANCELED', subscriptionId });
  }
}

async function endPaidPlan(
  userId: string,
  subscriptionId: string,
  status: 'refunded' | 'disputed',
): Promise<void> {
  const updated = await sql`
    UPDATE users
    SET plan = 'free', stripe_subscription_id = NULL, subscription_status = ${status}, updated_at = NOW()
    WHERE id = ${userId} AND stripe_subscription_id = ${subscriptionId}
    RETURNING id
  `;
  invalidatePlanCache(updated);
}

// Ends the 'disputed' hold: only a user still marked disputed on this subscription is touched.
async function releaseDispute(
  userId: string,
  subscriptionId: string,
  plan: string,
  status: string,
): Promise<void> {
  const updated = await sql`
    UPDATE users
    SET plan = ${plan}, subscription_status = ${status}, updated_at = NOW()
    WHERE id = ${userId} AND stripe_subscription_id = ${subscriptionId} AND subscription_status = 'disputed'
    RETURNING id
  `;
  invalidatePlanCache(updated);
}

/**
 * Get or create Stripe customer for user
 */
async function getOrCreateStripeCustomer(
  stripeClient: Stripe,
  userId: string,
  email: string,
): Promise<string> {
  // Check if user already has a Stripe customer ID
  const rows = await sql`
    SELECT stripe_customer_id FROM users WHERE id = ${userId} LIMIT 1
  `;

  if (rows?.[0]?.stripe_customer_id) {
    return rows[0].stripe_customer_id;
  }

  // Create new Stripe customer
  const customer = await stripeClient.customers.create({
    email,
    metadata: {
      userId,
    },
  });

  // Save customer ID to database
  await sql`
    UPDATE users
    SET stripe_customer_id = ${customer.id}, updated_at = NOW()
    WHERE id = ${userId}
  `;

  return customer.id;
}

const billingUserRoutes = new Elysia({ prefix: '/v1/billing' })
  .use(authedUser)

  /**
   * Create Stripe Checkout session
   * POST /v1/billing/create-checkout-session
   */
  .post(
    '/create-checkout-session',
    async ({ user, body, set }) => {
      try {
        const stripeClient = getStripe();
        const { priceId, successUrl, cancelUrl } = body;

        // Use provided priceId or default from env
        const allowedPrice = resolveAllowedPriceId(priceId);
        if (!priceId && !env.STRIPE_PRICE_ID) {
          set.status = 503;
          return { error: 'Billing unavailable' };
        }
        if (!allowedPrice) {
          set.status = 400;
          return { error: 'Unknown billing price' };
        }

        let validatedSuccessUrl: string;
        let validatedCancelUrl: string;
        try {
          validatedSuccessUrl = validateCheckoutUrl(successUrl, '/app/account?success=true');
          validatedCancelUrl = validateCheckoutUrl(cancelUrl, '/app/account?canceled=true');
        } catch {
          set.status = 400;
          return { error: 'Invalid checkout redirect URL' };
        }

        // Get or create Stripe customer
        const customerId = await getOrCreateStripeCustomer(
          stripeClient,
          user.userId,
          user.email || '',
        );

        // Create checkout session
        const session = await stripeClient.checkout.sessions.create({
          mode: 'subscription',
          customer: customerId,
          line_items: [{ price: allowedPrice.priceId, quantity: 1 }],
          success_url: validatedSuccessUrl,
          cancel_url: validatedCancelUrl,
          allow_promotion_codes: true,
          metadata: {
            userId: user.userId,
          },
        });

        logger.info({
          msg: 'BILLING_CHECKOUT_CREATED',
          userId: user.userId,
          sessionId: session.id,
        });

        return { id: session.id, url: session.url };
      } catch (err) {
        logger.error({ msg: 'BILLING_CHECKOUT_ERROR', error: err });
        set.status = 500;
        return { error: 'Failed to create checkout session' };
      }
    },
    {
      body: t.Object({
        priceId: t.Optional(t.String()),
        successUrl: t.Optional(t.String()),
        cancelUrl: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Get current subscription status
   * GET /v1/billing/subscription
   */
  .get('/subscription', async ({ user, set }) => {
    try {
      // Get user's subscription info from database
      const rows = await sql`
        SELECT plan, stripe_customer_id, stripe_subscription_id, subscription_status
        FROM users
        WHERE id = ${user.userId}
        LIMIT 1
      `;

      const userData = rows?.[0];

      return {
        plan: userData?.plan || 'free',
        stripeCustomerId: userData?.stripe_customer_id || null,
        subscriptionId: userData?.stripe_subscription_id || null,
        status: userData?.subscription_status || (userData?.plan === 'free' ? 'none' : 'active'),
      };
    } catch (err) {
      logger.error({ msg: 'BILLING_SUBSCRIPTION_ERROR', error: err });
      set.status = 500;
      return { error: 'Failed to fetch subscription status' };
    }
  })

  /**
   * Create Stripe Customer Portal session
   * POST /v1/billing/portal-session
   */
  .post('/portal-session', async ({ user, set }) => {
    try {
      const stripeClient = getStripe();

      // Get user's Stripe customer ID
      const rows = await sql`
        SELECT stripe_customer_id FROM users WHERE id = ${user.userId} LIMIT 1
      `;

      const customerId = rows?.[0]?.stripe_customer_id;
      if (!customerId) {
        set.status = 400;
        return { error: 'No subscription found' };
      }

      // Create portal session
      const portalSession = await stripeClient.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.APP_ORIGIN || 'https://infiniterealms.app'}/app/account`,
      });

      logger.info({
        msg: 'BILLING_PORTAL_CREATED',
        userId: user.userId,
      });

      return { url: portalSession.url };
    } catch (err) {
      logger.error({ msg: 'BILLING_PORTAL_ERROR', error: err });
      set.status = 500;
      return { error: 'Failed to create portal session' };
    }
  });

/**
 * Stripe calls the webhook without a user token; the handler verifies the signature instead.
 */
export const billingRoutes = new Elysia({ prefix: '/v1/billing' })
  .use(billingUserRoutes)

  /**
   * Stripe Webhook Handler
   * POST /v1/billing/webhook
   *
   * Note: This endpoint must receive raw body for signature verification.
   * Elysia handles this correctly when we access request.text() directly.
   */
  .post('/webhook', async ({ request, set }) => {
    let claimedEventId: string | undefined;
    try {
      const stripeClient = getStripe();
      const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

      if (!webhookSecret) {
        logger.error({ msg: 'STRIPE_WEBHOOK_SECRET not configured' });
        set.status = 500;
        return { error: 'Internal server error' };
      }

      const signature = request.headers.get('stripe-signature');
      if (!signature) {
        set.status = 400;
        return { error: 'Missing stripe-signature header' };
      }

      // Get raw body for signature verification
      const rawBody = await request.text();

      let event: Stripe.Event;
      try {
        // Use async version for Bun compatibility
        event = await stripeClient.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
      } catch (err: any) {
        logger.error({ msg: 'WEBHOOK_SIGNATURE_FAILED', error: err.message });
        set.status = 400;
        return { error: 'Invalid webhook signature' };
      }

      logger.info({
        msg: 'STRIPE_WEBHOOK_RECEIVED',
        type: event.type,
        eventId: event.id,
      });

      if (!(await claimStripeEvent(event.id, event.type))) {
        logger.info({ msg: 'STRIPE_WEBHOOK_DUPLICATE', eventId: event.id, type: event.type });
        return { received: true, duplicate: true };
      }
      claimedEventId = event.id;

      // Handle events
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          let userId = session.metadata?.userId;
          const customerId = session.customer as string;
          const subscriptionId = session.subscription as string;

          if (!userId) {
            const email = session.customer_details?.email || session.customer_email;
            if (email) {
              const matches =
                await sql`SELECT id FROM users WHERE lower(email) = lower(${email}) LIMIT 2`;
              if (matches.length === 1) userId = String(matches[0].id);
            }
          }

          if (userId) {
            // Update user with subscription info
            const updated = await sql`
              UPDATE users
              SET
                plan = 'pro',
                stripe_customer_id = ${customerId},
                stripe_subscription_id = ${subscriptionId},
                subscription_status = 'active',
                updated_at = NOW()
              WHERE id = ${userId}
              RETURNING id
            `;
            invalidatePlanCache(updated);

            logger.info({
              msg: 'SUBSCRIPTION_ACTIVATED',
              userId,
              subscriptionId,
            });

            // Log conversion event for analytics
            logger.info({
              msg: 'ANALYTICS_CONVERSION',
              event: 'checkout_completed',
              userId,
              customerId,
              subscriptionId,
              amountTotal: session.amount_total,
              currency: session.currency,
            });
          } else {
            logger.error({
              msg: 'STRIPE_PAID_CUSTOMER_UNRESOLVED',
              alert: true,
              severity: 'critical',
              eventId: event.id,
              sessionId: session.id,
              customerId,
              subscriptionId,
              customerEmail: session.customer_details?.email || session.customer_email || null,
              amountTotal: session.amount_total,
              currency: session.currency,
            });
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;
          const status = subscription.status;
          const priceId = subscription.items.data[0]?.price.id;
          const plan = getPlanFromPriceId(priceId);

          // Update user based on customer ID; an open dispute stays free until charge.dispute.closed
          const updated = await sql`
            UPDATE users
            SET
              plan = ${status === 'active' ? plan : 'free'},
              subscription_status = ${status},
              updated_at = NOW()
            WHERE stripe_customer_id = ${customerId}
              AND subscription_status IS DISTINCT FROM 'disputed'
              AND (plan IS DISTINCT FROM 'tester' OR stripe_subscription_id IS NOT NULL)
            RETURNING id
          `;
          invalidatePlanCache(updated);

          logger.info({
            msg: 'SUBSCRIPTION_UPDATED',
            customerId,
            status,
            plan,
          });

          // Log analytics event for plan changes
          logger.info({
            msg: 'ANALYTICS_SUBSCRIPTION',
            event: 'subscription_updated',
            customerId,
            status,
            plan,
            priceId,
          });
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          // Downgrade user to free
          const updated = await sql`
            UPDATE users
            SET
              plan = 'free',
              stripe_subscription_id = NULL,
              subscription_status = CASE
                WHEN subscription_status = 'refunded' THEN 'refunded'
                WHEN subscription_status = 'disputed' AND stripe_subscription_id IS NULL THEN 'disputed'
                ELSE 'canceled'
              END,
              updated_at = NOW()
            WHERE stripe_customer_id = ${customerId}
              AND (plan IS DISTINCT FROM 'tester' OR stripe_subscription_id IS NOT NULL)
            RETURNING id
          `;
          invalidatePlanCache(updated);

          logger.info({
            msg: 'SUBSCRIPTION_CANCELED',
            customerId,
          });

          // Log churn event for analytics
          logger.info({
            msg: 'ANALYTICS_CHURN',
            event: 'subscription_canceled',
            customerId,
          });
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as Stripe.Invoice;
          const customerId = invoice.customer as string;

          // Mark subscription as past_due
          await sql`
            UPDATE users
            SET
              subscription_status = 'past_due',
              updated_at = NOW()
            WHERE stripe_customer_id = ${customerId}
              AND subscription_status IS DISTINCT FROM 'disputed'
              AND subscription_status IS DISTINCT FROM 'refunded'
          `;

          logger.warn({
            msg: 'PAYMENT_FAILED',
            customerId,
          });

          // Log payment failure for analytics
          logger.info({
            msg: 'ANALYTICS_PAYMENT',
            event: 'payment_failed',
            customerId,
            invoiceId: invoice.id,
            amountDue: invoice.amount_due,
            currency: invoice.currency,
          });
          break;
        }

        case 'charge.refunded': {
          // Read refunded/customer/invoice from the pinned client, not the payload.
          const charge = await stripeClient.charges.retrieve(
            (event.data.object as Stripe.Charge).id,
          );
          if (!charge.refunded) {
            logger.info({ msg: 'CHARGE_PARTIALLY_REFUNDED', chargeId: charge.id });
            break;
          }
          const owner = await resolveChargeOwner(stripeClient, charge, event.id);
          if (!owner) break;

          await cancelSubscription(stripeClient, owner.subscriptionId);
          await endPaidPlan(owner.userId, owner.subscriptionId, 'refunded');
          logger.info({
            msg: 'CHARGE_REFUNDED_DOWNGRADE',
            userId: owner.userId,
            chargeId: charge.id,
          });
          break;
        }

        case 'charge.dispute.created': {
          const dispute = event.data.object as Stripe.Dispute;
          // Re-read: events can arrive out of order, and an inquiry (warning_*) is not a chargeback.
          const current = await stripeClient.disputes.retrieve(dispute.id);
          if (current.status !== 'needs_response' && current.status !== 'under_review') {
            logger.info({
              msg: 'DISPUTE_CREATED_NO_DOWNGRADE',
              disputeId: dispute.id,
              status: current.status,
            });
            break;
          }
          const charge = await stripeClient.charges.retrieve(idOf(dispute.charge) as string);
          const owner = await resolveChargeOwner(stripeClient, charge, event.id);
          if (!owner) break;

          // Subscription stays on file so a won dispute can restore the plan.
          const updated = await sql`
            UPDATE users
            SET plan = 'free', subscription_status = 'disputed', updated_at = NOW()
            WHERE id = ${owner.userId} AND stripe_subscription_id = ${owner.subscriptionId}
            RETURNING id
          `;
          invalidatePlanCache(updated);
          logger.warn({
            msg: 'CHARGE_DISPUTED_DOWNGRADE',
            userId: owner.userId,
            disputeId: dispute.id,
          });
          break;
        }

        case 'charge.dispute.closed': {
          const dispute = event.data.object as Stripe.Dispute;
          const won = dispute.status === 'won' || dispute.status === 'warning_closed';
          if (!won && dispute.status !== 'lost') {
            logger.info({
              msg: 'DISPUTE_CLOSED_NO_ACTION',
              disputeId: dispute.id,
              status: dispute.status,
            });
            break;
          }
          const charge = await stripeClient.charges.retrieve(idOf(dispute.charge) as string);
          const owner = await resolveChargeOwner(stripeClient, charge, event.id);
          if (!owner) break;

          if (!won) {
            await cancelSubscription(stripeClient, owner.subscriptionId);
            await endPaidPlan(owner.userId, owner.subscriptionId, 'disputed');
            logger.warn({
              msg: 'DISPUTE_LOST_DOWNGRADE',
              userId: owner.userId,
              disputeId: dispute.id,
            });
            break;
          }

          // Whatever Stripe says, the 'disputed' hold ends here so renewals can set the plan again.
          const subscription = await stripeClient.subscriptions.retrieve(owner.subscriptionId);
          const priceId = subscription.items.data[0]?.price.id;
          const plan = getPlanFromPriceId(priceId);
          if (subscription.status !== 'active' || plan === 'free') {
            logger.warn({
              msg:
                subscription.status !== 'active'
                  ? 'DISPUTE_WON_SUBSCRIPTION_INACTIVE'
                  : 'DISPUTE_WON_UNKNOWN_PRICE',
              userId: owner.userId,
              disputeId: dispute.id,
              status: subscription.status,
              priceId,
            });
            await releaseDispute(owner.userId, owner.subscriptionId, 'free', subscription.status);
            break;
          }
          await releaseDispute(owner.userId, owner.subscriptionId, plan, 'active');
          logger.info({ msg: 'DISPUTE_WON_RESTORED', userId: owner.userId, disputeId: dispute.id });
          break;
        }

        default:
          logger.info({ msg: 'UNHANDLED_WEBHOOK_EVENT', type: event.type });
      }

      return { received: true };
    } catch (err) {
      if (claimedEventId) {
        try {
          await sql`DELETE FROM processed_stripe_events WHERE event_id = ${claimedEventId}`;
        } catch (releaseError) {
          logger.error({
            msg: 'STRIPE_WEBHOOK_CLAIM_RELEASE_FAILED',
            eventId: claimedEventId,
            error: releaseError,
          });
        }
      }
      logger.error({ msg: 'WEBHOOK_ERROR', error: err });
      set.status = 500;
      return { error: 'Webhook handler failed' };
    }
  });
