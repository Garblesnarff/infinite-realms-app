/**
 * Durable per-reply record for a DM reply the server generated (#1416).
 *
 * One row per reserved reply id, holding the reply until it is safe to publish to
 * `dialogue_history`. `state` is the only lifecycle field:
 *   held → ready → persisted; held → cancelled | superseded; ready → ready (retry).
 * Transitions are guarded in `server-bun/src/services/dm/dm-reply-persistence.ts`.
 */
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { gameSessions } from './game';

export const dmReplyRecords = pgTable(
  'dm_reply_records',
  {
    /** The reserved reply id; the same id `dialogue_history` will carry once published. */
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    state: text('state').notNull(),
    /** The provisional narration (narration followed by lettered options). */
    text: text('text').notNull(),
    /** The engine envelope the reply was generated from, kept for diagnosis and restart. */
    envelope: jsonb('envelope'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    sessionIdx: index('idx_dm_reply_records_session_id').on(table.sessionId),
  }),
);
