import { Package, Shield, Sword } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { allEquipment, type Equipment } from '@/data/equipmentOptions';
import { useInventoryManager } from '@/features/character/hooks/use-inventory-manager';

import { CurrencySection } from './inventory/CurrencySection';
import { EquipmentShop } from './inventory/EquipmentShop';
import { InventoryStats } from './inventory/InventoryStats';
import { InventoryTabContent } from './inventory/InventoryTabContent';

interface InventoryManagerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * InventoryManager component for character equipment and inventory management
 */
const InventoryManager: React.FC<InventoryManagerProps> = ({ character, _onUpdate }) => {
  const {
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
  } = useInventoryManager(character);

  // Equipment filters
  const categories = [
    { value: 'all', label: 'All Items' },
    { value: 'weapon', label: 'Weapons' },
    { value: 'armor', label: 'Armor' },
    { value: 'shield', label: 'Shields' },
    { value: 'tool', label: 'Tools' },
    { value: 'gear', label: 'Gear' },
    { value: 'consumable', label: 'Consumables' },
  ];

  // Filter equipment for shop
  const filteredEquipment = allEquipment.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getItemIcon = (category: Equipment['category']): React.ReactNode => {
    switch (category) {
      case 'weapon':
        return <Sword className="w-4 h-4" />;
      case 'armor':
      case 'shield':
        return <Shield className="w-4 h-4" />;
      default:
        return <Package className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Character Stats */}
      <InventoryStats
        calculatedAC={calculatedAC}
        equippedArmor={equippedArmor}
        equippedShield={equippedShield}
        totalWeight={totalWeight}
        carryingCapacity={carryingCapacity}
        equippedWeaponsCount={equippedWeapons.length}
      />

      {/* Currency */}
      <CurrencySection currency={currency} updateCurrency={updateCurrency} />

      <Tabs defaultValue="inventory">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="shop">Equipment Shop</TabsTrigger>
        </TabsList>

        {/* Inventory Tab */}
        <TabsContent value="inventory">
          <InventoryTabContent
            inventory={inventory}
            showShop={showShop}
            setShowShop={setShowShop}
            toggleEquipped={toggleEquipped}
            sellItem={sellItem}
            removeFromInventory={removeFromInventory}
            getItemIcon={getItemIcon}
          />
        </TabsContent>

        {/* Shop Tab */}
        <TabsContent value="shop">
          <EquipmentShop
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            categories={categories}
            filteredEquipment={filteredEquipment}
            currency={currency}
            purchaseItem={purchaseItem}
            addToInventory={addToInventory}
            getItemIcon={getItemIcon}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default InventoryManager;
