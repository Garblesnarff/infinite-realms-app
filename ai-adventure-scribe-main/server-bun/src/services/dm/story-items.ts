/**
 * #218 step 3: items the story grants or takes (`items` in the reply) reach the inventory.
 * The server is the one writer: it inserts or removes `inventory_items` rows, which the
 * sheet reads on its next load. Same once-per-player-message key as the slot spend and
 * the XP award: Retry re-sends the same saved message, so a second movement for it must
 * not land again.
 *
 * Idempotency lives in `story_item_events`, one marker row per applied movement keyed on
 * the player message's timestamp (the server clock), in the style of `experience_events`.
 * The inventory rows themselves cannot serve as the marker: a loss deletes its rows, so a
 * retry would find nothing and remove again. The character row is locked first, so two
 * turns for one message cannot both read "nothing applied yet" and both write.
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { resolveCatalogItem } from '../../data/itemCatalog.js';
import { logger } from '../../lib/logger.js';

export type StoryItemChange = {
  name: string;
  quantity: number;
  change: 'gain' | 'lose';
};

export type StoryItemsOutcome =
  | 'applied'
  | 'already_applied'
  | 'invalid_items'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending';

/** A turn that moves more than this many item lines is a prompt bug, not loot. */
const MAX_ITEMS_PER_TURN = 10;

function validItems(items: unknown): items is StoryItemChange[] {
  if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS_PER_TURN)
    return false;
  return items.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const c = item as StoryItemChange;
    if (typeof c.name !== 'string' || c.name.trim().length === 0 || c.name.trim().length > 120)
      return false;
    if (!Number.isInteger(c.quantity) || c.quantity < 1 || c.quantity > 99) return false;
    return c.change === 'gain' || c.change === 'lose';
  });
}

export async function applyStoryItemsOnce(input: {
  characterId: string;
  sessionId: string;
  /** The player message's created_at (the server clock): the idempotency key. */
  playerMessageAt: Date;
  items: StoryItemChange[];
}): Promise<'applied' | 'already_applied'> {
  const { db } = await import('../../../../db/client');
  const { and, eq, sql } = await import('drizzle-orm');
  const { characters, inventoryItems, storyItemEvents } = await import(
    '../../../../db/schema/index'
  );
  const { characterId, sessionId, playerMessageAt, items } = input;
  return db.transaction(async (tx) => {
    // Lock the character row: two turns for one message cannot both read
    // "nothing applied yet" and both move the items.
    const [locked] = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (!locked) return 'already_applied';
    let anyApplied = false;
    // FIX round 3: two gain lines for the same item in one reply must both count.
    // Sum duplicate (name, change) lines before applying, so one idempotency
    // marker covers the total instead of the second line being skipped as a retry.
    const grouped = new Map<string, { name: string; quantity: number; change: 'gain' | 'lose' }>();
    for (const item of items) {
      const name = item.name.trim();
      const key = `${name.toLowerCase()}|${item.change}`;
      const existing = grouped.get(key);
      // The validation caps each line at 99; cap the summed total the same way.
      if (existing) existing.quantity = Math.min(99, existing.quantity + item.quantity);
      else grouped.set(key, { name, quantity: item.quantity, change: item.change });
    }
    for (const item of grouped.values()) {
      // FIX round 3: resolve the name against the item catalog first, so a found
      // "Longsword" lands with the right type and stats. Uncatalogued names fall
      // back to a free-text "equipment" row, as before.
      const catalog = item.change === 'gain' ? resolveCatalogItem(item.name) : null;
      const canonicalName = catalog?.name ?? item.name;
      const [marked] = await tx
        .select({ id: storyItemEvents.id })
        .from(storyItemEvents)
        .where(
          and(
            eq(storyItemEvents.characterId, characterId),
            eq(storyItemEvents.sessionId, sessionId),
            eq(storyItemEvents.playerMessageAt, playerMessageAt),
            eq(sql`lower(${storyItemEvents.itemName})`, canonicalName.toLowerCase()),
            eq(storyItemEvents.change, item.change),
          ),
        )
        .limit(1);
      if (marked) continue;
      if (item.change === 'gain') {
        // FIX round 3: a row with the same item already on the character absorbs
        // the find — three finds of Torch are one row of quantity 3, not three rows.
        const [existing] = await tx
          .select({ id: inventoryItems.id, quantity: inventoryItems.quantity })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.characterId, characterId),
              eq(sql`lower(${inventoryItems.name})`, canonicalName.toLowerCase()),
            ),
          )
          .orderBy(inventoryItems.createdAt)
          .limit(1);
        if (existing) {
          // The catalog is authoritative for the item's stats: backfill them onto
          // the matched row so a legacy free-text row (e.g. itemType 'equipment')
          // still lands with the right type and stats on the next find.
          await tx
            .update(inventoryItems)
            .set({
              quantity: existing.quantity + item.quantity,
              ...(catalog
                ? {
                    itemType: catalog.itemType,
                    weight: String(catalog.weight),
                    description: catalog.description,
                    properties: catalog.properties,
                    requiresAttunement: catalog.requiresAttunement,
                  }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(inventoryItems.id, existing.id));
        } else {
          await tx.insert(inventoryItems).values({
            characterId,
            name: canonicalName,
            itemType: catalog?.itemType ?? 'equipment',
            quantity: item.quantity,
            weight: catalog ? String(catalog.weight) : '0',
            description: catalog?.description ?? 'Found in the story',
            properties: catalog?.properties ?? null,
            requiresAttunement: catalog?.requiresAttunement ?? false,
          });
        }
      } else {
        const rows = await tx
          .select({ id: inventoryItems.id, quantity: inventoryItems.quantity })
          .from(inventoryItems)
          .where(
            and(
              eq(inventoryItems.characterId, characterId),
              eq(sql`lower(${inventoryItems.name})`, canonicalName.toLowerCase()),
            ),
          )
          .orderBy(inventoryItems.createdAt);
        let remaining = item.quantity;
        for (const row of rows) {
          if (remaining <= 0) break;
          if (row.quantity <= remaining) {
            await tx.delete(inventoryItems).where(eq(inventoryItems.id, row.id));
            remaining -= row.quantity;
          } else {
            await tx
              .update(inventoryItems)
              .set({ quantity: row.quantity - remaining, updatedAt: new Date() })
              .where(eq(inventoryItems.id, row.id));
            remaining = 0;
          }
        }
      }
      await tx.insert(storyItemEvents).values({
        characterId,
        sessionId,
        playerMessageAt,
        itemName: canonicalName,
        change: item.change,
        quantity: item.quantity,
      });
      anyApplied = true;
    }
    return anyApplied ? 'applied' : 'already_applied';
  });
}

/** Reads the reply's `items` and applies them for the session's own character. */
export async function applyStoryItems(input: {
  userId: string;
  sessionId: string;
  items: unknown;
  /** The reply asks for a roll: the outcome is not known yet, so nothing changes hands yet. */
  rollRequested?: boolean;
}): Promise<StoryItemsOutcome> {
  const { userId, sessionId } = input;
  // An empty list is the model saying "nothing changes hands": a no-op, not an error.
  if (Array.isArray(input.items) && input.items.length === 0) return 'already_applied';
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  let outcome: StoryItemsOutcome;
  if (!character) outcome = 'no_character';
  // The movement belongs to the roll's result, which arrives as its own player message.
  else if (input.rollRequested) outcome = 'roll_pending';
  else if (!validItems(input.items)) outcome = 'invalid_items';
  // No saved player message, no key to apply once against: the turn answers nothing the player did.
  else if (!message?.createdAt) outcome = 'no_player_message';
  else {
    outcome = await applyStoryItemsOnce({
      characterId: character.id,
      sessionId,
      playerMessageAt: message.createdAt,
      items: input.items,
    });
  }
  logger.info({
    msg: 'DM_STORY_ITEMS',
    sessionId,
    characterId: character?.id ?? null,
    count: Array.isArray(input.items) ? input.items.length : 0,
    outcome,
  });
  return outcome;
}
