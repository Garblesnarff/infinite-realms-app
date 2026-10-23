import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RightSheetLive } from '../RightSheetLive';

import type { InventoryItemVM } from '../types';

const captured = vi.hoisted(() => ({
  props: undefined as
    | undefined
    | {
        equippingItemId?: string;
        equipActionError?: string;
        onEquipItem?: (item: InventoryItemVM) => Promise<void>;
      },
  dispatch: vi.fn(),
}));

const equipApi = vi.hoisted(() => ({
  equipCharacterItem: vi.fn(async () => ({ armorClass: 15 })),
}));

vi.mock('../RightSheet', () => ({
  RightSheet: (props: NonNullable<typeof captured.props>) => {
    captured.props = props;
    return null;
  },
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: {
      character: {
        id: 'char-1',
        inventory: [{ itemId: 'Shortbow', equipped: false }],
        character_stats: { armor_class: 13 },
      },
    },
    dispatch: captured.dispatch,
  }),
}));
vi.mock('../useOverhaulViewModel', () => ({
  useOverhaulViewModel: () => ({
    character: { spells: { cantrips: [], known: [], prepared: [] } },
  }),
}));
vi.mock('@/services/character-equipment-api', () => ({
  equipCharacterItem: equipApi.equipCharacterItem,
}));

/**
 * #1059: RightSheetLive's Equip wiring — the click goes to the equip
 * route, the character state follows (row equipped, the server's
 * re-synced armor class), a second click mid-flight is ignored, and a
 * refused equip surfaces as the sheet's error with nothing dispatched.
 */
describe('RightSheetLive equip wiring (#1059)', () => {
  it('equips through the service and folds the row + armor class into the character', async () => {
    render(<RightSheetLive />);
    await act(async () => {
      await captured.props?.onEquipItem?.({ id: 'Shortbow', name: 'Shortbow' });
    });

    expect(equipApi.equipCharacterItem).toHaveBeenCalledWith('char-1', 'Shortbow');
    expect(captured.dispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: {
        inventory: [{ itemId: 'Shortbow', equipped: true }],
        character_stats: { armor_class: 15 },
      },
    });
    expect(captured.props?.equippingItemId).toBeUndefined();
    expect(captured.props?.equipActionError).toBeUndefined();
  });

  it('ignores a second equip click while one is in flight', async () => {
    equipApi.equipCharacterItem.mockClear();
    let release: (() => void) | undefined;
    equipApi.equipCharacterItem.mockImplementationOnce(
      () =>
        new Promise<{ armorClass: number }>((resolve) => {
          release = () => resolve({ armorClass: 13 });
        }),
    );
    render(<RightSheetLive />);

    let first: Promise<void> | undefined;
    act(() => {
      first = captured.props?.onEquipItem?.({ id: 'Shortbow', name: 'Shortbow' });
    });
    expect(captured.props?.equippingItemId).toBe('Shortbow');
    await act(async () => {
      await captured.props?.onEquipItem?.({ id: 'Dagger', name: 'Dagger' });
    });
    expect(equipApi.equipCharacterItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
      await first;
    });
    expect(captured.props?.equippingItemId).toBeUndefined();
  });

  it('shows the refusal on the sheet and dispatches nothing', async () => {
    equipApi.equipCharacterItem.mockRejectedValueOnce(new Error('Unable to equip Shortbow.'));
    captured.dispatch.mockClear();
    render(<RightSheetLive />);
    await act(async () => {
      await captured.props?.onEquipItem?.({ id: 'Shortbow', name: 'Shortbow' });
    });

    expect(captured.props?.equipActionError).toBe('Unable to equip Shortbow.');
    expect(captured.dispatch).not.toHaveBeenCalled();
  });
});
