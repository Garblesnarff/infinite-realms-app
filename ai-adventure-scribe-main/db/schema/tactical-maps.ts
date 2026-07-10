import { sql } from 'drizzle-orm';
import { boolean, index, jsonb, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { gameSessions } from './game';

/** Persisted server-authoritative combat map. Inactive rows are retained for history. */
export const tacticalMaps = pgTable('tactical_maps', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => gameSessions.id, { onDelete: 'cascade' }),
  state: jsonb('state').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index('idx_tactical_maps_session_id').on(table.sessionId),
  oneActiveMapPerSession: uniqueIndex('tactical_maps_one_active_session').on(table.sessionId).where(sql`${table.active} = true`),
}));
