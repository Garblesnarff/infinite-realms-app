/**
 * Spell Slots Schema
 *
 * Database tables for D&D 5E spell slot tracking and usage logging.
 * Supports character-specific spell slots for levels 1-9 and historical usage logs.
 */

import { relations, sql } from 'drizzle-orm';
import { pgTable, uuid, text, timestamp, integer, index, unique, check } from 'drizzle-orm/pg-core';

import { characters, gameSessions } from './game.js';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Character Spell Slots Table
 * Tracks current and maximum spell slots for each character by spell level (1-9)
 */
export const characterSpellSlots = pgTable(
  'character_spell_slots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
    spellLevel: integer('spell_level').notNull(),
    totalSlots: integer('total_slots').notNull().default(0),
    usedSlots: integer('used_slots').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    characterIdx: index('idx_spell_slots_character').on(table.characterId),
    characterLevelIdx: index('idx_spell_slots_character_level').on(table.characterId, table.spellLevel),
    uniqueCharacterSpellLevel: unique('unique_character_spell_level').on(table.characterId, table.spellLevel),
    spellLevelCheck: check('spell_level_check', sql`${table.spellLevel} BETWEEN 1 AND 9`),
    validSlotUsage: check('valid_slot_usage', sql`${table.usedSlots} <= ${table.totalSlots}`),
  })
);

/**
 * Spell Slot Usage Log Table
 * Historical log of all spell slot usage for tracking and analytics
 */
export const spellSlotUsageLog = pgTable(
  'spell_slot_usage_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id').references(() => gameSessions.id, { onDelete: 'cascade' }),
    spellName: text('spell_name').notNull(),
    spellLevel: integer('spell_level').notNull(),
    slotLevelUsed: integer('slot_level_used').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    characterIdx: index('idx_spell_usage_log_character').on(table.characterId),
    sessionIdx: index('idx_spell_usage_log_session').on(table.sessionId),
    characterSessionIdx: index('idx_spell_usage_log_character_session').on(table.characterId, table.sessionId),
    timestampIdx: index('idx_spell_usage_log_timestamp').on(table.timestamp),
    validSpellLevel: check('valid_spell_level', sql`${table.spellLevel} BETWEEN 0 AND 9`),
    validSlotLevel: check('valid_slot_level', sql`${table.slotLevelUsed} BETWEEN 1 AND 9`),
  })
);

// Define relations
export const characterSpellSlotsRelations = relations(characterSpellSlots, ({ one }) => ({
  character: one(characters, {
    fields: [characterSpellSlots.characterId],
    references: [characters.id],
  }),
}));

export const spellSlotUsageLogRelations = relations(spellSlotUsageLog, ({ one }) => ({
  character: one(characters, {
    fields: [spellSlotUsageLog.characterId],
    references: [characters.id],
  }),
  session: one(gameSessions, {
    fields: [spellSlotUsageLog.sessionId],
    references: [gameSessions.id],
  }),
}));

// Type exports
export type CharacterSpellSlot = InferSelectModel<typeof characterSpellSlots>;
export type NewCharacterSpellSlot = InferInsertModel<typeof characterSpellSlots>;
export type SpellSlotUsageEntry = InferSelectModel<typeof spellSlotUsageLog>;
export type NewSpellSlotUsageEntry = InferInsertModel<typeof spellSlotUsageLog>;
