/**
 * Users Schema
 *
 * User accounts managed by WorkOS AuthKit.
 * This replaces Supabase auth.users for authentication.
 */

import { pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Users Table
 * Stores user account information from WorkOS AuthKit
 */
export const users = pgTable(
  'users',
  {
    // WorkOS user ID (primary key)
    id: text('id').primaryKey(),

    // User profile information
    email: text('email').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),

    // Subscription plan
    plan: text('plan').default('free').notNull(),
    abVariant: text('ab_variant'),

    // Stripe subscription fields
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    subscriptionStatus: text('subscription_status'), // active, past_due, canceled, none

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('idx_users_email').on(table.email),
    planIdx: index('idx_users_plan').on(table.plan),
    abVariantIdx: index('idx_users_ab_variant').on(table.abVariant),
    stripeCustomerIdx: index('idx_users_stripe_customer').on(table.stripeCustomerId),
  })
);

// Type exports
export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
