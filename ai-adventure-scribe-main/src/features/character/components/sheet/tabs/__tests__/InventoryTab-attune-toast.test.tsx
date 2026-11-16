import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import InventoryTab from '../InventoryTab';

import type { Character } from '@/types/character';

const toastMock = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('@/hooks/use-magic-item-attunement', () => ({
  useMagicItemAttunement: () => ({
    attuneToItem: vi.fn().mockResolvedValue({
      success: false,
      message: 'Attunement needs a short rest spent on this item',
    }),
    removeAttunement: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
    getAttunementSummary: () => ({ attunedCount: 0, maxAttunementSlots: 3, isAtCapacity: false }),
    isAttuning: false,
  }),
}));

function hero(): Character {
  return {
    id: 'hero-toast',
    name: 'Hero',
    inventory: [
      {
        itemId: 'magic-sword',
        itemName: 'Magic Sword',
        quantity: 1,
        equipped: true,
        isMagic: true,
        requiresAttunement: true,
        isAttuned: false,
      },
    ],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
  } as unknown as Character;
}

describe('InventoryTab attune toast', () => {
  it('toasts the server reason on attune failure', async () => {
    const user = userEvent.setup();
    render(<InventoryTab character={hero()} onUpdate={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Attune' }));
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Attunement needs a short rest spent on this item',
          variant: 'destructive',
        }),
      );
    });
  });
});
