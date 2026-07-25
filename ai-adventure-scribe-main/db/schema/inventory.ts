/**
 * Inventory Schema
 *
 * Database tables for D&D 5E inventory management system.
 * Includes item tracking, ammunition, consumables, weight/encumbrance, and attunement.
 */

import { relations } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  numeric,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';

import { characters, gameSessions } from './game';

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

/**
 * Inventory Items Table
 * Stores all items in a character's inventory
 */
export const inventoryItems = pgTable(
  'inventory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    itemType: text('item_type').notNull(), // weapon, armor, consumable, ammunition, equipment, treasure
    quantity: integer('quantity').notNull().default(1),
    weight: numeric('weight', { precision: 5, scale: 2 }).default('0'),
    description: text('description'),
    properties: text('properties'), // JSON string for flexible properties
    isEquipped: boolean('is_equipped').notNull().default(false),
    isAttuned: boolean('is_attuned').notNull().default(false),
    requiresAttunement: boolean('requires_attunement').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    characterIdIdx: index('idx_inventory_character').on(table.characterId),
    itemTypeIdx: index('idx_inventory_item_type').on(table.characterId, table.itemType),
  }),
);

/** Legacy character-sheet equipment table used by character creation. */
export const characterEquipment = pgTable(
  'character_equipment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    itemName: text('item_name').notNull(),
    itemType: text('item_type').default('equipment'),
    quantity: integer('quantity').default(1),
    equipped: boolean('equipped').default(false),
    isMagic: boolean('is_magic').default(false),
    magicBonus: integer('magic_bonus').default(0),
    magicProperties: text('magic_properties'),
    requiresAttunement: boolean('requires_attunement').default(false),
    isAttuned: boolean('is_attuned').default(false),
    attunementRequirements: text('attunement_requirements'),
    magicItemType: text('magic_item_type'),
    magicItemRarity: text('magic_item_rarity').default('common'),
    // jsonb in prod since 20260710_align_character_equipment.sql; this file was
    // never updated to match, so `magic_effects` was typed as text here for
    // over two weeks (drizzle would've read the driver's parsed JS object back
    // as a "string" per the old type). Corrected 2026-07-25.
    magicEffects: jsonb('magic_effects'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).defaultNow(),
  },
  (table) => ({
    characterItemIdx: index('idx_character_equipment_character_item').on(
      table.characterId,
      table.itemName,
    ),
  }),
);

/**
 * Consumable Usage Log Table
 * Tracks when consumables/ammunition are used
 */
export const consumableUsageLog = pgTable(
  'consumable_usage_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    characterId: uuid('character_id')
      .notNull()
      .references(() => characters.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => inventoryItems.id, { onDelete: 'cascade' }),
    quantityUsed: integer('quantity_used').notNull().default(1),
    sessionId: uuid('session_id').references(() => gameSessions.id, { onDelete: 'set null' }),
    context: text('context'),
    timestamp: timestamp('timestamp', { withTimezone: true, mode: 'date' }).defaultNow().notNull(),
  },
  (table) => ({
    characterIdIdx: index('idx_consumable_usage_character').on(table.characterId),
    itemIdIdx: index('idx_consumable_usage_item').on(table.itemId),
    sessionIdIdx: index('idx_consumable_usage_session').on(table.sessionId),
    timestampIdx: index('idx_consumable_usage_timestamp').on(table.timestamp),
  }),
);

// Define relations
export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  character: one(characters, {
    fields: [inventoryItems.characterId],
    references: [characters.id],
  }),
  usageLogs: many(consumableUsageLog),
}));

export const consumableUsageLogRelations = relations(consumableUsageLog, ({ one }) => ({
  character: one(characters, {
    fields: [consumableUsageLog.characterId],
    references: [characters.id],
  }),
  item: one(inventoryItems, {
    fields: [consumableUsageLog.itemId],
    references: [inventoryItems.id],
  }),
  session: one(gameSessions, {
    fields: [consumableUsageLog.sessionId],
    references: [gameSessions.id],
  }),
}));

// Type exports
export type InventoryItem = InferSelectModel<typeof inventoryItems>;
export type NewInventoryItem = InferInsertModel<typeof inventoryItems>;
export type ConsumableUsageLog = InferSelectModel<typeof consumableUsageLog>;
export type NewConsumableUsageLog = InferInsertModel<typeof consumableUsageLog>;
