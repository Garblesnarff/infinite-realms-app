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

import { authenticateRequest } from '../../lib/auth.js';
import { sql } from '../../lib/db.js';
import { env } from '../../lib/env.js';
import { logger } from '../../lib/logger.js';

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

/**
 * Map Stripe price ID to plan name
 */
function getPlanFromPriceId(priceId: string | undefined): string {
  if (!priceId) return 'free';
  // For now, any paid price means 'pro' plan
  // Can expand later for multiple tiers
  return 'pro';
}

/**
 * Get or create Stripe customer for user
 */
async function getOrCreateStripeCustomer(
  stripeClient: Stripe,
  userId: string,
  email: string
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

export const billingRoutes = new Elysia({ prefix: '/v1/billing' })

  /**
   * Create Stripe Checkout session
   * POST /v1/billing/create-checkout-session
   */
  .post(
    '/create-checkout-session',
    async ({ request, body, set }) => {
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }

      try {
        const stripeClient = getStripe();
        const { priceId, successUrl, cancelUrl } = body;

        // Use provided priceId or default from env
        const finalPriceId = priceId || env.STRIPE_PRICE_ID;
        if (!finalPriceId) {
          set.status = 503;
          return { error: 'Billing unavailable' };
        }

        // Get or create Stripe customer
        const customerId = await getOrCreateStripeCustomer(
          stripeClient,
          user.userId,
          user.email || ''
        );

        // Create checkout session
        const session = await stripeClient.checkout.sessions.create({
          mode: 'subscription',
          customer: customerId,
          line_items: [{ price: finalPriceId, quantity: 1 }],
          success_url: successUrl || `${process.env.APP_ORIGIN || 'https://infiniterealms.app'}/app/account?success=true`,
          cancel_url: cancelUrl || `${process.env.APP_ORIGIN || 'https://infiniterealms.app'}/app/account?canceled=true`,
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
    }
  )

  /**
   * Get current subscription status
   * GET /v1/billing/subscription
   */
  .get('/subscription', async ({ request, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

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
  .post('/portal-session', async ({ request, set }) => {
    const { user, error } = await authenticateRequest(request);
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

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
  })

  /**
   * Stripe Webhook Handler
   * POST /v1/billing/webhook
   *
   * Note: This endpoint must receive raw body for signature verification.
   * Elysia handles this correctly when we access request.text() directly.
   */
  .post('/webhook', async ({ request, set }) => {
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

      // Handle events
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object as Stripe.Checkout.Session;
          const userId = session.metadata?.userId;
          const customerId = session.customer as string;
          const subscriptionId = session.subscription as string;

          if (userId) {
            // Update user with subscription info
            await sql`
              UPDATE users
              SET
                plan = 'pro',
                stripe_customer_id = ${customerId},
                stripe_subscription_id = ${subscriptionId},
                subscription_status = 'active',
                updated_at = NOW()
              WHERE id = ${userId}
            `;

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
          }
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;
          const status = subscription.status;
          const priceId = subscription.items.data[0]?.price.id;
          const plan = getPlanFromPriceId(priceId);

          // Update user based on customer ID
          await sql`
            UPDATE users
            SET
              plan = ${status === 'active' ? plan : 'free'},
              subscription_status = ${status},
              updated_at = NOW()
            WHERE stripe_customer_id = ${customerId}
          `;

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
          await sql`
            UPDATE users
            SET
              plan = 'free',
              stripe_subscription_id = NULL,
              subscription_status = 'canceled',
              updated_at = NOW()
            WHERE stripe_customer_id = ${customerId}
          `;

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

        default:
          logger.info({ msg: 'UNHANDLED_WEBHOOK_EVENT', type: event.type });
      }

      return { received: true };
    } catch (err) {
      logger.error({ msg: 'WEBHOOK_ERROR', error: err });
      set.status = 500;
      return { error: 'Webhook handler failed' };
    }
  });
