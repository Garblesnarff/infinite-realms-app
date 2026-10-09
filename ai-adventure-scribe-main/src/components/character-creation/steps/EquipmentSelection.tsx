import { Check } from 'lucide-react';
import React from 'react';

import type { Equipment } from '@/data/equipmentOptions';

import { StartingGoldOption } from '@/components/character-creation/steps/equipment-selection/StartingGoldOption';
import { Card } from '@/components/ui/card';
import { useCharacter } from '@/contexts/CharacterContext';
import { backgrounds } from '@/data/backgroundOptions';
import { getStartingEquipment, startingGoldByClass } from '@/data/equipmentOptions';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import { useToast } from '@/hooks/use-toast';

/**
 * Equipment Selection component for character creation
 * Allows users to select their starting equipment based on class and background
 */
const EquipmentSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();
  const characterClass = state.character?.class;
  const characterBackground = state.character?.background;

  // #2710: derive gold state from currency so it survives remount.
  // hasRolledGold is true when currency.gp > 0.
  const rolledGold = state.character?.currency?.gp || 0;
  const hasRolledGold = rolledGold > 0;

  // Get starting equipment options based on character class
  const startingEquipment = characterClass ? getStartingEquipment(characterClass.name) : [];
  const goldData = characterClass ? startingGoldByClass[characterClass.id] : undefined;

  // #2710: the gold option is the card that doesn't select equipment.
  // Derive from the selected index, not a hardcoded comparison elsewhere.
  const GOLD_OPTION_INDEX = 1;
  const isGoldSelected = state.character?.selectedEquipmentOptionIndex === GOLD_OPTION_INDEX;

  /**
   * Handles equipment selection and updates character state
   * Adds background equipment automatically and updates character state
   * @param selectedEquipment Array of selected equipment
   * @param optionIndex Index of the selected equipment option
   */
  const handleEquipmentSelect = (selectedEquipment: Equipment[], optionIndex: number) => {
    const equipmentNames = selectedEquipment.map((eq) => eq.name);
    let totalEquipment: string[] = [...equipmentNames];

    // Automatically add background equipment if background is selected
    if (characterBackground) {
      const backgroundEquip =
        backgrounds.find((b) => b.id === characterBackground.id)?.equipment || [];
      totalEquipment = [...backgroundEquip, ...equipmentNames];
    }

    const isGold = selectedEquipment.length === 0;

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        equipment: totalEquipment,
        selectedEquipmentOptionIndex: optionIndex,
        // #2710: switching back to the package clears any rolled gold.
        // Selecting gold without a roll uses the average (see below).
        ...(isGold
          ? {}
          : { currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 } }),
      },
    });

    // #2710: if the gold card is chosen without rolling, use the average
    // so Continue doesn't leave 0 gold.
    if (isGold && !hasRolledGold && goldData) {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          currency: { cp: 0, sp: 0, ep: 0, gp: goldData.average, pp: 0 },
        },
      });
    }
    toast({
      title: isGold ? 'Starting Gold Selected' : 'Equipment Selected',
      description: `Your ${isGold ? 'starting gold' : 'starting equipment'} has been added to your inventory${characterBackground ? ' along with background items' : ''}.`,
      duration: 1000,
    });

    // Auto-scroll to navigation to proceed to next step
    scrollToNavigation();
  };

  // #2710: roll starting gold using the class's dice formula
  const handleRollGold = () => {
    if (!goldData) return;
    const [count, sides] = goldData.dice.split('d').map(Number);
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += Math.floor(Math.random() * sides) + 1;
    }
    const gold = total * goldData.multiplier;
    // Set currency directly so it's saved; hasRolledGold derives from it.
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        currency: { cp: 0, sp: 0, ep: 0, gp: gold, pp: 0 },
      },
    });
  };

  const handleResetRoll = () => {
    // #2710: Reset clears currency too.
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
      },
    });
  };

  if (!characterClass) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-center mb-4">Choose Your Equipment</h2>
        <div className="text-center text-muted-foreground">
          Please select a character class first to see available equipment options.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-center mb-4">Choose Your Equipment</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Equipment Package Option */}
        <Card
          className={`p-4 cursor-pointer transition-all hover:shadow-lg border-2 relative ${
            state.character?.selectedEquipmentOptionIndex === 0
              ? 'border-primary bg-accent/10'
              : 'border-transparent'
          }`}
          onClick={() => handleEquipmentSelect(startingEquipment, 0)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleEquipmentSelect(startingEquipment, 0);
            }
          }}
        >
          {state.character?.selectedEquipmentOptionIndex === 0 && (
            <div className="absolute top-3 right-3">
              <div className="bg-primary text-primary-foreground rounded-full p-1">
                <Check className="w-4 h-4" />
              </div>
            </div>
          )}
          <h3 className="text-xl font-semibold mb-2">{characterClass.name} Equipment Package</h3>
          <ul className="list-disc list-inside space-y-1">
            {startingEquipment.map((equipment, itemIndex) => (
              <li key={itemIndex} className="text-sm text-muted-foreground">
                {equipment.name}
              </li>
            ))}
          </ul>
        </Card>

        {/* Starting Gold Option */}
        <Card
          className={`p-4 cursor-pointer transition-all hover:shadow-lg border-2 relative ${
            isGoldSelected
              ? 'border-primary bg-accent/10'
              : 'border-transparent'
          }`}
          onClick={() => handleEquipmentSelect([], 1)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleEquipmentSelect([], 1);
            }
          }}
        >
          {isGoldSelected && (
            <div className="absolute top-3 right-3">
              <div className="bg-primary text-primary-foreground rounded-full p-1">
                <Check className="w-4 h-4" />
              </div>
            </div>
          )}
          <h3 className="text-xl font-semibold mb-2">Starting Gold</h3>
          <p className="text-sm text-muted-foreground mb-2">
            Roll for starting gold instead of taking the equipment package.
          </p>
          <p className="text-xs text-muted-foreground">
            You can use the gold to buy equipment during character creation.
          </p>
        </Card>
      </div>
      {/* #2710: show the gold roller when the gold option is selected.
          If goldData is missing (unknown class), don't show the roller —
          gold stays 0 rather than silently failing. */}
      {isGoldSelected && goldData && (
        <StartingGoldOption
          goldData={goldData}
          hasRolledGold={hasRolledGold}
          rolledGold={rolledGold}
          onRollGold={handleRollGold}
          onResetRoll={handleResetRoll}
        />
      )}
      {characterBackground && (
        <div className="text-sm text-muted-foreground">
          <strong>Note:</strong> Background equipment ({characterBackground.name}) will be
          automatically added to your inventory.
        </div>
      )}
    </div>
  );
};

export default EquipmentSelection;
