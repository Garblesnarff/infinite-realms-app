/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/data/equipmentOptions', () => ({
  calculateArmorClass: vi.fn(() => 10),
  convertCurrency: vi.fn((amount, from, to) => {
    if (from === to) return amount;
    // Simple mock conversion for testing: 1gp = 1gp
    return amount;
  }),
  formatCurrency: vi.fn((cost) => `${cost.amount} ${cost.currency}`),
}));

import { currencyToCopper, spendCurrency, useInventoryManager } from '../use-inventory-manager';

import * as equipmentOptions from '@/data/equipmentOptions';

describe('useInventoryManager', () => {
  const mockCharacter: any = {
    id: 'char-123',
    name: 'Test Character',
    abilityScores: {
      strength: { score: 10, modifier: 0 },
      dexterity: { score: 14, modifier: 2 },
      constitution: { score: 12, modifier: 1 },
      wisdom: { score: 10, modifier: 0 },
    },
    class: { name: 'Fighter' },
  };

  const mockEquipment: any = {
    id: 'item-1',
    name: 'Longsword',
    category: 'weapon',
    cost: { amount: 15, currency: 'gp' },
    weight: 3,
  };

  const mockArmor: any = {
    id: 'armor-1',
    name: 'Leather Armor',
    category: 'armor',
    cost: { amount: 10, currency: 'gp' },
    weight: 10,
  };

  const mockShield: any = {
    id: 'shield-1',
    name: 'Shield',
    category: 'shield',
    cost: { amount: 10, currency: 'gp' },
    weight: 6,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    expect(result.current.inventory).toEqual([]);
    expect(result.current.currency).toEqual({ cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 });
    expect(result.current.searchTerm).toBe('');
    expect(result.current.selectedCategory).toBe('all');
    expect(result.current.showShop).toBe(false);
  });

  it('should add items to inventory', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.addToInventory(mockEquipment, 2);
    });

    expect(result.current.inventory).toHaveLength(1);
    expect(result.current.inventory[0]).toMatchObject({
      ...mockEquipment,
      quantity: 2,
      equipped: false,
    });
  });

  it('should stack existing items in inventory', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.addToInventory(mockEquipment, 1);
    });
    act(() => {
      result.current.addToInventory(mockEquipment, 2);
    });

    expect(result.current.inventory).toHaveLength(1);
    expect(result.current.inventory[0].quantity).toBe(3);
  });

  it('should remove items from inventory', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.addToInventory(mockEquipment, 5);
    });
    act(() => {
      result.current.removeFromInventory(mockEquipment.id, 2);
    });

    expect(result.current.inventory[0].quantity).toBe(3);

    act(() => {
      result.current.removeFromInventory(mockEquipment.id, 3);
    });

    expect(result.current.inventory).toHaveLength(0);
  });

  it('should toggle equipment status', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.addToInventory(mockEquipment, 1);
    });

    act(() => {
      result.current.toggleEquipped(mockEquipment.id);
    });

    expect(result.current.inventory[0].equipped).toBe(true);
    expect(result.current.equippedWeapons).toHaveLength(1);

    act(() => {
      result.current.toggleEquipped(mockEquipment.id);
    });

    expect(result.current.inventory[0].equipped).toBe(false);
  });

  it('should handle mutually exclusive armor', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));
    const armor2 = { ...mockArmor, id: 'armor-2', name: 'Plate' };

    act(() => {
      result.current.addToInventory(mockArmor);
      result.current.addToInventory(armor2);
    });

    act(() => {
      result.current.toggleEquipped(mockArmor.id);
    });
    expect(result.current.inventory.find((i) => i.id === mockArmor.id)?.equipped).toBe(true);

    act(() => {
      result.current.toggleEquipped(armor2.id);
    });

    expect(result.current.inventory.find((i) => i.id === mockArmor.id)?.equipped).toBe(false);
    expect(result.current.inventory.find((i) => i.id === armor2.id)?.equipped).toBe(true);
  });

  it('should handle mutually exclusive shields', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));
    const shield2 = { ...mockShield, id: 'shield-2', name: 'Magic Shield' };

    act(() => {
      result.current.addToInventory(mockShield);
      result.current.addToInventory(shield2);
    });

    act(() => {
      result.current.toggleEquipped(mockShield.id);
    });
    expect(result.current.inventory.find((i) => i.id === mockShield.id)?.equipped).toBe(true);

    act(() => {
      result.current.toggleEquipped(shield2.id);
    });

    expect(result.current.inventory.find((i) => i.id === mockShield.id)?.equipped).toBe(false);
    expect(result.current.inventory.find((i) => i.id === shield2.id)?.equipped).toBe(true);
  });

  it('should calculate AC correctly', async () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    vi.mocked(equipmentOptions.calculateArmorClass).mockReturnValue(15);

    await act(async () => {
      result.current.addToInventory(mockArmor);
    });

    await act(async () => {
      result.current.toggleEquipped(mockArmor.id);
    });

    expect(result.current.inventory.find((i) => i.id === mockArmor.id)?.equipped).toBe(true);
    expect(result.current.equippedArmor?.id).toBe(mockArmor.id);

    expect(equipmentOptions.calculateArmorClass).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: mockArmor.id }),
      null, // shield
      2, // dex
      0, // bonus
      'Fighter',
      1, // con
      0, // wis
    );
    expect(result.current.calculatedAC).toBe(15);
  });

  it('should purchase items if enough currency', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));
    vi.mocked(equipmentOptions.convertCurrency).mockReturnValue(15);

    act(() => {
      result.current.purchaseItem(mockEquipment);
    });

    expect(currencyToCopper(result.current.currency)).toBe(8500);
    expect(result.current.inventory).toHaveLength(1);
  });

  it('should not purchase items if insufficient funds', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));
    vi.mocked(equipmentOptions.convertCurrency).mockReturnValue(1000);

    act(() => {
      result.current.purchaseItem({ ...mockEquipment, cost: { amount: 1001, currency: 'gp' } });
    });

    expect(result.current.currency.gp).toBe(100);
    expect(result.current.inventory).toHaveLength(0);
  });

  it('should sell items for half value', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));
    vi.mocked(equipmentOptions.convertCurrency).mockReturnValue(20);

    act(() => {
      result.current.addToInventory(mockEquipment, 1);
    });

    act(() => {
      result.current.sellItem(result.current.inventory[0]);
    });

    expect(result.current.currency.gp).toBe(110); // 100 + 20/2
    expect(result.current.inventory).toHaveLength(0);
  });

  it('should calculate total weight and carrying capacity', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.addToInventory(mockEquipment, 10); // 10 * 3 = 30
      result.current.addToInventory(mockArmor, 1); // 10
    });

    expect(result.current.totalWeight).toBe(40);
    expect(result.current.carryingCapacity).toBe(150); // 10 * 15
  });

  it('should update currency', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.updateCurrency('gp', 500);
    });

    expect(result.current.currency.gp).toBe(500);
  });

  it('spends across denominations and returns canonical change', () => {
    expect(currencyToCopper({ cp: 5, sp: 2, ep: 1, gp: 1, pp: 1 })).toBe(1175);
    expect(spendCurrency({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 1 }, 155)).toEqual({
      cp: 5,
      sp: 4,
      ep: 0,
      gp: 8,
      pp: 0,
    });
  });

  it('initializes persisted currency and persists edits through character updates', () => {
    const onUpdate = vi.fn();
    const character = { ...mockCharacter, currency: { cp: 4, sp: 3, ep: 2, gp: 1, pp: 0 } };
    const { result } = renderHook(() => useInventoryManager(character, onUpdate));

    expect(result.current.currency).toEqual(character.currency);
    act(() => result.current.updateCurrency('sp', 9));
    expect(onUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: { cp: 4, sp: 9, ep: 2, gp: 1, pp: 0 } }),
    );
  });

  it('should handle search term and category updates', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.setSearchTerm('sword');
      result.current.setSelectedCategory('weapon');
      result.current.setShowShop(true);
    });

    expect(result.current.searchTerm).toBe('sword');
    expect(result.current.selectedCategory).toBe('weapon');
    expect(result.current.showShop).toBe(true);
  });

  it('should return early when toggling non-existent item', () => {
    const { result } = renderHook(() => useInventoryManager(mockCharacter));

    act(() => {
      result.current.toggleEquipped('non-existent');
    });

    expect(result.current.inventory).toEqual([]);
  });
});
