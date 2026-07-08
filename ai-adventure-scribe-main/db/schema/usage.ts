/**
 * Usage and billing idempotency schema.
 */

import { date, index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export const aiUsage = pgTable(
  'ai_usage',
  {
    orgId: text('org_id'),
    userId: text('user_id'),
    plan: text('plan'),
    type: text('type'),
    units: integer('units').notNull(),
    periodStart: date('period_start', { mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    provider: text('provider'),
    model: text('model'),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    totalTokens: integer('total_tokens').default(0).notNull(),
    costUsd: numeric('cost_usd', { precision: 12, scale: 8 }).default('0').notNull(),
  },
  (table) => ({
    userDailyCostIdx: index('idx_ai_usage_user_daily_cost').on(table.userId, table.periodStart),
  }),
);

export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  eventType: text('event_type').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' })
    .defaultNow()
    .notNull(),
});

export type AiUsage = InferSelectModel<typeof aiUsage>;
export type NewAiUsage = InferInsertModel<typeof aiUsage>;
export type ProcessedStripeEvent = InferSelectModel<typeof processedStripeEvents>;
export type NewProcessedStripeEvent = InferInsertModel<typeof processedStripeEvents>;
