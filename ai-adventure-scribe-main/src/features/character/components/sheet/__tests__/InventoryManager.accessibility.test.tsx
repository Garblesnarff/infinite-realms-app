import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';

import InventoryManager from '../InventoryManager';
import type { Character } from '@/types/character';

// Mock the hook
vi.mock('@/features/character/hooks/use-inventory-manager', () => ({
  useInventoryManager: () => ({
    inventory: [
      { id: '1', name: 'Longsword', category: 'weapon', quantity: 1, equipped: true, description: 'A sharp sword.' },
      { id: '2', name: 'Shield', category: 'shield', quantity: 1, equipped: false, description: 'A sturdy shield.' },
    ],
    currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 },
    searchTerm: '',
    setSearchTerm: vi.fn(),
    selectedCategory: 'all',
    setSelectedCategory: vi.fn(),
    showShop: false,
    setShowShop: vi.fn(),
    equippedArmor: null,
    equippedShield: null,
    equippedWeapons: [],
    calculatedAC: 10,
    totalWeight: 5,
    carryingCapacity: 150,
    addToInventory: vi.fn(),
    removeFromInventory: vi.fn(),
    toggleEquipped: vi.fn(),
    purchaseItem: vi.fn(),
    sellItem: vi.fn(),
    updateCurrency: vi.fn(),
  }),
}));

describe('InventoryManager Accessibility', () => {
  const mockCharacter = {
    id: 'char-123',
    name: 'Test Character',
  } as Character;

  it('should have correct aria-labels for equipment checkboxes', () => {
    render(<InventoryManager character={mockCharacter} onUpdate={vi.fn()} />);

    // Check for "Unequip Longsword" (since it starts equipped in our mock)
    const longswordCheckbox = screen.getByLabelText('Unequip Longsword');
    expect(longswordCheckbox).toBeInTheDocument();

    // Check for "Equip Shield" (since it starts unequipped in our mock)
    const shieldCheckbox = screen.getByLabelText('Equip Shield');
    expect(shieldCheckbox).toBeInTheDocument();
  });
});
