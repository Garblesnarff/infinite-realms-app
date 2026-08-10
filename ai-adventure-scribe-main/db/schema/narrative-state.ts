/**
 * Narrative State Schema
 *
 * Bi-temporal ledger of narrative facts. One row per assertion; facts are
 * superseded, never overwritten, so the current state of a subject is a single
 * partial-index lookup and the full history stays available for debugging and
 * correction.
 *
 * Target architecture: docs/memory-system-design-v2.md §3.1. This table implements the
 * pre-Phase-1 slice — keyed by `session_id` with `subject_name` as identity — NOT v2's
 * `playthrough_id` + `entity_id` target. The re-key is #1670 Phase 1, and per issue #1691
 * it must not start until this table is actually deployed.
 */

import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
  boolean,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { campaigns, gameSessions } from './game';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Enums
 */
export const factSubjectEnum = pgEnum('fact_subject_type', [
  'npc',
  'location',
  'item',
  'quest',
  'faction',
  'party',
  'world',
  'thread',
]);

/**
 * Narrative Facts Table
 * Tier 1 truth store: looked up (never similarity-retrieved) for `<scene_state>`.
 * Open predicate vocabulary on a closed row shape - new campaigns need new
 * values, never new columns.
 */
export const narrativeFacts = pgTable(
  'narrative_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    campaignId: uuid('campaign_id').references(() => campaigns.id, { onDelete: 'cascade' }),

    subjectType: factSubjectEnum('subject_type').notNull(),
    subjectName: text('subject_name').notNull(), // canonical, case-folded key
    predicate: text('predicate').notNull(), // open vocab: 'status', 'location',
    // 'disposition_to_party', 'owes', 'promised', 'has_item', 'knows', ...
    value: jsonb('value').notNull(), // {"state":"dead","turn":12} ...

    // Belief vs truth (NarrativeEngine-P knownBy; EvolvingWorld hidden tracker)
    knownBy: jsonb('known_by').$type<string[]>().default(['dm']).notNull(), // ['dm','player','npc:balthazar']
    isBelief: boolean('is_belief').default(false).notNull(), // subject believes it; may be false

    // Provenance + trust
    source: text('source').notNull(), // 'engine' | 'dm_delta' | 'player_correction'
    turnIndex: integer('turn_index'),
    messageId: uuid('message_id'),
    needsReview: boolean('needs_review').default(false).notNull(), // staged, NOT injected

    // Bi-temporal supersession (Graphiti's model, two columns' worth)
    validFrom: timestamp('valid_from', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true, mode: 'date' }),
    invalidatedBy: uuid('invalidated_by'), // narrative_facts.id of the superseding row

    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    // THE index: current state of a subject is one indexed lookup, and a
    // double-write is a constraint violation instead of silent corruption.
    currentFactIdx: uniqueIndex('idx_facts_current')
      .on(table.sessionId, table.subjectType, table.subjectName, table.predicate)
      .where(sql`invalidated_at IS NULL`),
    sessionIdx: index('idx_facts_session').on(table.sessionId, table.subjectType),
  }),
);

// Type exports for TypeScript inference
export type NarrativeFact = InferSelectModel<typeof narrativeFacts>;
export type NewNarrativeFact = InferInsertModel<typeof narrativeFacts>;
