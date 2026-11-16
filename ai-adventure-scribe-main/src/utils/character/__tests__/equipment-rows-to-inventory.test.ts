import { describe, expect, it } from 'vitest';

import { SHEET_ATTUNE_ROW_ID } from '../../../../shared/test-fixtures/sheet-attune-wire';

import type { Issue1784EquipmentRow } from '@/services/issue-1784-api';

import { equipmentRowsToInventory } from '@/utils/character/equipment-rows-to-inventory';

// Fixture follows the real producer: the /v1/characters/:id/equipment
// response rows, which load-character-with-spells feeds to the game sheet.
const baseRow: Issue1784EquipmentRow = {
  id: 'row-arrows',
  character_id: 'char-1',
  item_name: 'Arrows',
  item_type: 'ammunition',
  equipped: false,
  is_magic: false,
  magic_bonus: 0,
};

describe('equipmentRowsToInventory (#1327 item 3)', () => {
  it('preserves a spent-to-zero quantity instead of falling back to 1', () => {
    const [item] = equipmentRowsToInventory([{ ...baseRow, quantity: 0 }]);
    expect(item.quantity).toBe(0);
  });

  it('falls back to 1 when the row carries no quantity', () => {
    const [missing] = equipmentRowsToInventory([{ ...baseRow, quantity: undefined }]);
    expect(missing.quantity).toBe(1);

    const [nulled] = equipmentRowsToInventory([{ ...baseRow, quantity: null }]);
    expect(nulled.quantity).toBe(1);
  });

  it('passes a positive quantity through unchanged', () => {
    const [item] = equipmentRowsToInventory([{ ...baseRow, quantity: 20 }]);
    expect(item.quantity).toBe(20);
  });

  it('keeps the item name in itemId and carries the row id attune posts', () => {
    const [item] = equipmentRowsToInventory([
      {
        ...baseRow,
        id: SHEET_ATTUNE_ROW_ID,
        item_name: 'Cloak of Protection',
        requires_attunement: true,
        is_attuned: false,
      },
    ]);
    expect(item.itemId).toBe('Cloak of Protection');
    expect(item.equipmentId).toBe(SHEET_ATTUNE_ROW_ID);
    expect(item.requiresAttunement).toBe(true);
    expect(item.isAttuned).toBe(false);
  });
});
