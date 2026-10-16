# Inventory source of truth

`character_equipment` is the source of truth for what a character owns, has equipped, and has attuned.

The character wizard and the sheet write that table (`CharacterService.create` / `update`, `issue-1784-data-service`). It holds the attunement columns the sheet shows. `inventory_items` is the story-grant ledger (`server-bun/src/services/dm/story-items.ts`, issue #592). A wizard item is often not in `inventory_items` at all. Making `inventory_items` the source of truth would hide starting gear until a migration copies the rows. That migration is Part B. This note does not move or delete either table.

## Reads routed to `character_equipment`

- Attune, unattune, and `GET /attuned` (`inventory-attunement-service.ts`). The token may be the equipment row id (the character sheet) or the item name (the game loader). A story grant with no sheet row still resolves on `inventory_items`.
- Equipped and carried weapons (`combat/data-access.ts`). An `inventory_items` row whose name is already on the sheet is not a second weapon.
- Armour class (`character/character-armor-class.ts`) and the DM loadout's armour list (`combat/equipped-loadout.ts`) use the same name rule. A story-only armour name is still read from `inventory_items`.

## Still on `inventory_items`

- Story grants and losses (`dm/story-items.ts`) write the `inventory_items` ledger AND mirror to `character_equipment` in the same transaction (interim mirror, #463). The ledger remains the record of what the story granted; the mirror is what the sheet reads.
- Consumables, ammunition, and carried weight (`inventory-consumable-service.ts`, `inventory-data-access.ts`). `character_equipment` has no weight column.
- `POST /inventory/:itemId/equip`. The sheet's Equip button does not call it. Equip on the sheet is a character PUT, which writes `character_equipment.equipped`.
- Character JSON export reads both tables so a download stays complete (`routes/v1/characters.ts`).

## Part B

Part B (copy story grants onto `character_equipment`) is implemented as an interim mirror: `applyStoryItemsOnce` in `dm/story-items.ts` upserts the mirrored row in the same transaction as the `inventory_items` write, matching on `lower(item_name)` to respect `UNIQUE(character_id, item_name)`. The sheet Inventory tab reads the mirrored rows via `GET /v1/characters/:id/equipment`. Dropping one of the tables is a later migration, not this change.
