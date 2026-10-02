/**
 * Feedback Schema
 *
 * Player feedback from the "Send feedback" modal (game header, /app/account).
 * POST /v1/feedback inserts one row per submission. Nothing reads this table yet.
 */

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    message: text('message').notNull(),
    // Client route the modal was opened on, e.g. "/app/account".
    page: text('page').notNull(),
    // Deployed build short SHA from GET /version (the bundle stamp if /version failed).
    build: text('build'),
    campaignSlug: text('campaign_slug'),
    sessionId: text('session_id'),
    // WorkOS user id; null when the request carried no valid token.
    userId: text('user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index('idx_feedback_created_at').on(table.createdAt),
  }),
);

export type Feedback = InferSelectModel<typeof feedback>;
export type NewFeedback = InferInsertModel<typeof feedback>;
