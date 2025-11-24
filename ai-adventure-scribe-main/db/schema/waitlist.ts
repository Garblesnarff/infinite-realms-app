/**
 * Waitlist Schema
 *
 * Tracks email signups from the landing page waitlist.
 * Users who sign up here will receive confirmation emails via Resend.
 */

import { pgTable, text, timestamp, index, uuid } from 'drizzle-orm/pg-core';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Waitlist Table
 * Stores email addresses of users who signed up for early access
 */
export const waitlist = pgTable(
  'waitlist',
  {
    // Unique ID for each signup
    id: uuid('id').defaultRandom().primaryKey(),

    // User information
    email: text('email').notNull().unique(),
    name: text('name'),

    // Metadata
    source: text('source').default('launch_page').notNull(), // Where they signed up from
    status: text('status').default('pending').notNull(), // pending, contacted, converted

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index('idx_waitlist_email').on(table.email),
    statusIdx: index('idx_waitlist_status').on(table.status),
    createdAtIdx: index('idx_waitlist_created_at').on(table.createdAt),
  })
);

// Type exports
export type Waitlist = InferSelectModel<typeof waitlist>;
export type NewWaitlist = InferInsertModel<typeof waitlist>;
