import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { campaigns, gameSessions } from './game';

/**
 * Campaign-instance journal. New entry types intentionally share this table so
 * quest logs, player notes, and recaps can join without a second journal model.
 */
export const campaignJournalEntries = pgTable(
  'campaign_journal_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignId: uuid('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    entryType: text('entry_type').notNull(),
    handoutMode: text('handout_mode'),
    handoutKey: text('handout_key'),
    title: text('title').notNull(),
    body: text('body'),
    giver: text('giver'),
    assetPath: text('asset_path'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    campaignCreatedIdx: index('idx_campaign_journal_entries_campaign_created').on(
      table.campaignId,
      table.createdAt,
    ),
    sessionCreatedIdx: index('idx_campaign_journal_entries_session_created').on(
      table.sessionId,
      table.createdAt,
    ),
  }),
);
