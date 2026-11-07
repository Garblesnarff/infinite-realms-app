import React, { useState } from 'react';

import { AttunementSection } from './inventory/AttunementSection';
import { CurrencyCard, type Currency } from './inventory/CurrencyCard';
import { EquipmentSection } from './inventory/EquipmentSection';
import { StartingEquipmentChooser } from './inventory/StartingEquipmentChooser';
import { WeightCard } from './inventory/WeightCard';

import type { Character } from '@/types/character';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const [chooserOpen, setChooserOpen] = useState(false);
  const hasNoEquipment = !character.inventory || character.inventory.length === 0;

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

      {/* A hero with no equipment rows (e.g. created with the Equipment step skipped, #1402) can pick a package here. */}
      {hasNoEquipment && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            No starting equipment is saved for this hero.
          </p>
          <Button onClick={() => setChooserOpen(true)}>Choose starting equipment</Button>
        </div>
      )}
      <Dialog open={chooserOpen} onOpenChange={setChooserOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose starting equipment</DialogTitle>
            <DialogDescription>
              Pick the class equipment package or starting gold. It is saved to this hero.
            </DialogDescription>
          </DialogHeader>
          <StartingEquipmentChooser
            character={character}
            onSave={onUpdate}
            onDone={() => setChooserOpen(false)}
          />
        </DialogContent>
      </Dialog>

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
