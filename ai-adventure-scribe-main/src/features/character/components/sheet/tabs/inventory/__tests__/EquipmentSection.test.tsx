import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Character } from '@/types/character';
import type { CharacterEquipmentRow } from '@/utils/character/data-transformers';

import { EquipmentSection } from '@/features/character/components/sheet/tabs/inventory/EquipmentSection';
import { transformCharacterData } from '@/utils/character/data-transformers';

// Fixture follows the real producer: character_equipment rows from the DB,
// where `id` is the row UUID and `item_name` is the display name. The sheet
// loads them through transformCharacterData — the same producer the
// character sheet uses — so the rendered names prove the loader fix.
const ROW_UUID_1 = '37c4f5ff-3909-4834-9668-bc2347a99004';
const ROW_UUID_2 = '8f2e1a4b-6c3d-4e5f-8a7b-9c0d1e2f3a4b';

const equipmentRows: CharacterEquipmentRow[] = [
  {
    id: ROW_UUID_1,
    item_name: 'Chain Mail',
    item_type: 'armor',
    quantity: 1,
    equipped: true,
    is_magic: false,
  },
  {
    id: ROW_UUID_2,
    item_name: 'Longsword',
    item_type: 'weapon',
    quantity: 1,
    equipped: true,
    is_magic: false,
  },
];

const characterRow = {
  id: 'char-205',
  user_id: 'user-205',
  name: 'Veteran',
  race: 'Human',
  class: 'Fighter',
  level: 3,
  experience_points: 900,
  alignment: 'Lawful Good',
} as Parameters<typeof transformCharacterData>[0];

function renderSection(character: Character) {
  return render(
    <EquipmentSection
      character={character}
      isAttuning={false}
      toggleEquipped={vi.fn()}
      handleAttuneToggle={vi.fn()}
    />,
  );
}

describe('EquipmentSection (#205)', () => {
  it('renders item names, not row UUIDs, for sheet-loaded inventory', () => {
    const character = transformCharacterData(characterRow, null, equipmentRows);
    const { container } = renderSection(character);

    expect(screen.getByText('Chain Mail')).toBeInTheDocument();
    expect(screen.getByText('Longsword')).toBeInTheDocument();

    // The row UUIDs must not appear anywhere in the rendered rows.
    expect(container.textContent).not.toContain(ROW_UUID_1);
    expect(container.textContent).not.toContain(ROW_UUID_2);
  });
});
