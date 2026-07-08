import { useState } from 'react';

import type { Equipment } from '@/data/equipmentOptions';
import type { Character } from '@/types/character';

import { calculateArmorClass, convertCurrency, formatCurrency } from '@/data/equipmentOptions';
import { useToast } from '@/hooks/use-toast';

export interface InventoryItem extends Equipment {
  quantity: number;
  equipped: boolean;
}

export interface Currency {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

const COPPER_VALUE: Record<keyof Currency, number> = { cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000 };

export const currencyToCopper = (currency: Currency): number =>
  Object.entries(currency).reduce(
    (total, [denomination, amount]) =>
      total + amount * COPPER_VALUE[denomination as keyof Currency],
    0,
  );

export const spendCurrency = (currency: Currency, costInCopper: number): Currency | null => {
  const remaining = currencyToCopper(currency) - costInCopper;
  if (remaining < 0) return null;

  let value = remaining;
  const result: Currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  for (const denomination of ['pp', 'gp', 'ep', 'sp', 'cp'] as const) {
    result[denomination] = Math.floor(value / COPPER_VALUE[denomination]);
    value %= COPPER_VALUE[denomination];
  }
  return result;
};

export const useInventoryManager = (
  character: Character,
  onCharacterUpdate?: (updatedCharacter: Character) => void,
): {
  inventory: InventoryItem[];
  currency: Currency;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedCategory: string;
  setSelectedCategory: (category: string) => void;
  showShop: boolean;
  setShowShop: (show: boolean) => void;
  equippedArmor: InventoryItem | undefined;
  equippedShield: InventoryItem | undefined;
  equippedWeapons: InventoryItem[];
  calculatedAC: number;
  totalWeight: number;
  carryingCapacity: number;
  addToInventory: (equipment: Equipment, quantity?: number) => void;
  removeFromInventory: (itemId: string, quantity?: number) => void;
  toggleEquipped: (itemId: string) => void;
  purchaseItem: (equipment: Equipment) => void;
  sellItem: (item: InventoryItem) => void;
  updateCurrency: (type: keyof Currency, amount: number) => void;
} => {
  const { toast } = useToast();

  // State management
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [currency, setCurrency] = useState<Currency>(
    character.currency ?? { cp: 0, sp: 0, ep: 0, gp: 100, pp: 0 },
  );
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [showShop, setShowShop] = useState(false);

  // Get equipped items
  const equippedArmor = inventory.find((item) => item.equipped && item.category === 'armor');
  const equippedShield = inventory.find((item) => item.equipped && item.category === 'shield');
  const equippedWeapons = inventory.filter((item) => item.equipped && item.category === 'weapon');

  // Calculate AC with unarmored defense support
  const dexModifier = character?.abilityScores?.dexterity?.modifier || 0;
  const conModifier = character?.abilityScores?.constitution?.modifier || 0;
  const wisModifier = character?.abilityScores?.wisdom?.modifier || 0;
  const characterClass = character?.class?.name || '';

  const calculatedAC = calculateArmorClass(
    equippedArmor || null,
    equippedShield || null,
    dexModifier,
    0, // otherBonuses
    characterClass,
    conModifier,
    wisModifier,
  );

  // Calculate total weight
  const totalWeight = inventory.reduce(
    (total, item) => total + (item.weight || 0) * item.quantity,
    0,
  );
  const carryingCapacity = (character?.abilityScores?.strength?.score || 10) * 15; // STR x 15 lbs

  /**
   * Add item to inventory
   */
  const addToInventory = (equipment: Equipment, quantity: number = 1): void => {
    const existingItem = inventory.find((item) => item.id === equipment.id);

    if (existingItem) {
      setInventory((prev) =>
        prev.map((item) =>
          item.id === equipment.id ? { ...item, quantity: item.quantity + quantity } : item,
        ),
      );
    } else {
      const newItem: InventoryItem = {
        ...equipment,
        quantity,
        equipped: false,
      };
      setInventory((prev) => [...prev, newItem]);
    }

    toast({
      title: 'Item Added',
      description: `Added ${quantity}x ${equipment.name} to inventory.`,
    });
  };

  /**
   * Remove item from inventory
   */
  const removeFromInventory = (itemId: string, quantity: number = 1): void => {
    setInventory(
      (prev) =>
        prev
          .map((item) => {
            if (item.id === itemId) {
              const newQuantity = Math.max(0, item.quantity - quantity);
              return newQuantity > 0 ? { ...item, quantity: newQuantity } : null;
            }
            return item;
          })
          .filter(Boolean) as InventoryItem[],
    );

    toast({
      title: 'Item Removed',
      description: `Removed ${quantity}x item from inventory.`,
    });
  };

  /**
   * Toggle equipment status
   */
  const toggleEquipped = (itemId: string): void => {
    const item = inventory.find((i) => i.id === itemId);
    if (!item) return;

    // Handle armor/shield - only one can be equipped
    if (item.category === 'armor') {
      setInventory((prev) =>
        prev.map((i) => ({
          ...i,
          equipped: i.category === 'armor' ? i.id === itemId && !i.equipped : i.equipped,
        })),
      );
    } else if (item.category === 'shield') {
      setInventory((prev) =>
        prev.map((i) => ({
          ...i,
          equipped: i.category === 'shield' ? i.id === itemId && !i.equipped : i.equipped,
        })),
      );
    } else {
      // Other items can be equipped/unequipped normally
      setInventory((prev) =>
        prev.map((i) => (i.id === itemId ? { ...i, equipped: !i.equipped } : i)),
      );
    }

    const action = item.equipped ? 'Unequipped' : 'Equipped';
    toast({
      title: `${action} Item`,
      description: `${action} ${item.name}.`,
    });
  };

  /**
   * Purchase item (subtract cost from currency)
   */
  const purchaseItem = (equipment: Equipment): void => {
    const costInCopper =
      equipment.cost.amount * COPPER_VALUE[equipment.cost.currency as keyof Currency];
    const remainingCurrency = spendCurrency(currency, costInCopper);

    if (remainingCurrency) {
      setCurrency(remainingCurrency);
      onCharacterUpdate?.({ ...character, currency: remainingCurrency });
      addToInventory(equipment);

      toast({
        title: 'Item Purchased',
        description: `Purchased ${equipment.name} for ${formatCurrency(equipment.cost)}.`,
      });
    } else {
      toast({
        title: 'Insufficient Funds',
        description: `You need ${formatCurrency(equipment.cost)} to purchase this item.`,
        variant: 'destructive',
      });
    }
  };

  /**
   * Sell item (add value to currency)
   */
  const sellItem = (item: InventoryItem): void => {
    const sellValue = Math.floor(convertCurrency(item.cost.amount, item.cost.currency, 'gp') / 2);
    setCurrency((previous) => {
      const updated = { ...previous, gp: previous.gp + sellValue };
      onCharacterUpdate?.({ ...character, currency: updated });
      return updated;
    });
    removeFromInventory(item.id, 1);

    toast({
      title: 'Item Sold',
      description: `Sold ${item.name} for ${sellValue} gp.`,
    });
  };

  /**
   * Update currency
   */
  const updateCurrency = (type: keyof Currency, amount: number): void => {
    setCurrency((previous) => {
      const updated = { ...previous, [type]: Math.max(0, amount) };
      onCharacterUpdate?.({ ...character, currency: updated });
      return updated;
    });
  };

  return {
    inventory,
    currency,
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    showShop,
    setShowShop,
    equippedArmor,
    equippedShield,
    equippedWeapons,
    calculatedAC,
    totalWeight,
    carryingCapacity,
    addToInventory,
    removeFromInventory,
    toggleEquipped,
    purchaseItem,
    sellItem,
    updateCurrency,
  };
};
