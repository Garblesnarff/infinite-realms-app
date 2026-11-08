import React from 'react';

import { withStartingPackageEquipped } from '../../../../../../../shared/creation-armor-class';

import type { Character } from '@/types/character';

import {
  splitBareGold,
  startingGoldFor,
} from '@/components/character-creation/steps/equipment-selection/starting-equipment';
import EquipmentSelection from '@/components/character-creation/steps/EquipmentSelection';
import { Button } from '@/components/ui/button';
import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';

interface StartingEquipmentChooserProps {
  character: Character;
  /** The sheet's save path. It writes the changed inventory and gold through PUT /v1/characters/:id. */
  onSave: (updated: Character) => unknown;
  onDone: () => void;
}

const ChooserBody: React.FC<StartingEquipmentChooserProps> = ({ character, onSave, onDone }) => {
  const { state } = useCharacter();
  const chosen = state.character;
  const hasChoice = chosen?.selectedEquipmentOptionIndex !== undefined;

  const handleSave = (): void => {
    if (!chosen || !hasChoice) return;
    // Same loadout rule as the wizard's create (#710): armor, shield and the first weapon are
    // worn. Background coins become gold, not item rows (#971).
    const { items: names } = splitBareGold(chosen.equipment ?? []);
    const worn = withStartingPackageEquipped(
      names.map((item_name) => ({ item_name, equipped: false })),
    );
    const inventory = worn.map((item) => ({
      itemId: String(item.item_name),
      itemName: String(item.item_name),
      itemType: 'equipment',
      quantity: 1,
      equipped: item.equipped === true,
    }));
    void onSave({
      ...character,
      inventory,
      currency: {
        cp: character.currency?.cp ?? 0,
        sp: character.currency?.sp ?? 0,
        ep: character.currency?.ep ?? 0,
        pp: character.currency?.pp ?? 0,
        gp: startingGoldFor(chosen),
      },
    });
    onDone();
  };

  return (
    <div className="space-y-4">
      <EquipmentSelection />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!hasChoice}>
          Save starting equipment
        </Button>
      </div>
    </div>
  );
};

/**
 * The wizard's package list (EquipmentSelection) for a hero who has no equipment rows.
 * It runs in a nested CharacterProvider seeded with the hero's class and background, so the
 * wizard's state is not touched.
 */
export const StartingEquipmentChooser: React.FC<StartingEquipmentChooserProps> = (props) => {
  const { character } = props;
  return (
    <CharacterProvider
      initialCharacter={{
        class: character.class ?? null,
        background: character.background ?? null,
        equipment: [],
        currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      }}
    >
      <ChooserBody {...props} />
    </CharacterProvider>
  );
};
