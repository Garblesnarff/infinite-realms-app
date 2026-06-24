import React from 'react';

import { AttunementSection } from './inventory/AttunementSection';
import { CurrencyCard, type Currency } from './inventory/CurrencyCard';
import { EquipmentSection } from './inventory/EquipmentSection';
import { WeightCard } from './inventory/WeightCard';

import type { Character } from '@/types/character';

import { useMagicItemAttunement } from '@/hooks/use-magic-item-attunement';


interface InventoryTabProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * Inventory & Equipment tab with weight tracking and currency management
 * Refactored to use sub-components for improved maintainability.
 */
const InventoryTab: React.FC<InventoryTabProps> = ({ character, onUpdate }) => {
  // Extract currency from character or use defaults
  const currency: Currency = {
    cp: character.currency?.cp || 0,
    sp: character.currency?.sp || 0,
    ep: character.currency?.ep || 0,
    gp: character.currency?.gp || 0,
    pp: character.currency?.pp || 0,
  };

  const { attuneToItem, removeAttunement, getAttunementSummary, isAttuning } =
    useMagicItemAttunement(character, onUpdate);

  const toggleEquipped = (itemId: string) => {
    const updatedCharacter = {
      ...character,
      inventory:
        character.inventory?.map((item) =>
          item.itemId === itemId ? { ...item, equipped: !item.equipped } : item,
        ) || [],
    };

    onUpdate(updatedCharacter);
  };

  const handleAttuneToggle = async (itemId: string) => {
    const item = character.inventory?.find((invItem) => invItem.itemId === itemId);
    if (!item) return;

    if (item.isAttuned) {
      await removeAttunement(itemId);
    } else {
      await attuneToItem(itemId);
    }
  };

  // Get attunement summary
  const attunementSummary = getAttunementSummary();

  return (
    <div className="space-y-6">
      {/* Currency & Weight */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <CurrencyCard currency={currency} />
        <WeightCard character={character} currency={currency} />
      </div>

      {/* Equipment */}
      <EquipmentSection
        character={character}
        isAttuning={isAttuning}
        toggleEquipped={toggleEquipped}
        handleAttuneToggle={handleAttuneToggle}
      />

      {/* Attunement Slots */}
      <AttunementSection
        character={character}
        attunedCount={attunementSummary.attunedCount}
        maxAttunementSlots={attunementSummary.maxAttunementSlots}
        isAtCapacity={attunementSummary.isAtCapacity}
      />
    </div>
  );
};

export default InventoryTab;
