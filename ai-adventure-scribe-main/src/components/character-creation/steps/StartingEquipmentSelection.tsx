import { Package, Coins, TrendingUp } from 'lucide-react';
import React, { useState, useId } from 'react';

import { parseStartingGoldDice } from './character-creation-input-bounds';
import { EquipmentPackagePreview } from './equipment-selection/EquipmentPackagePreview';
import {
  getStartingEquipmentPackage,
  calculateEstimatedACFromEquipment,
} from './equipment-selection/EquipmentSelectionUtils';
import { StartingGoldOption } from './equipment-selection/StartingGoldOption';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useCharacter } from '@/contexts/CharacterContext';
import {
  startingGoldByClass,
  EQUIPMENT_LOOKUP,
  getStartingEquipmentChoices,
} from '@/data/equipmentOptions';
import { useToast } from '@/hooks/use-toast';

/**
 * Starting Equipment Selection component for character creation
 * Allows choosing between equipment packages or starting gold
 */
const StartingEquipmentSelection: React.FC = () => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const titleId = useId();
  const packageId = useId();
  const goldId = useId();
  const character = state.character;
  const characterClass = character?.class;

  const [method, setMethod] = useState<'package' | 'gold'>('package');
  const [rolledGold, setRolledGold] = useState<number>(0);
  const [hasRolledGold, setHasRolledGold] = useState(false);
  const [choiceSelections, setChoiceSelections] = useState<Record<number, number>>({});
  const srdEquipment = React.useMemo(
    () => getStartingEquipmentChoices(characterClass?.id ?? ''),
    [characterClass?.id],
  );

  /**
   * ⚡ Bolt: Memoized starting equipment calculation.
   * Moved before early return to satisfy react-hooks/rules-of-hooks.
   */
  const startingEquipment = React.useMemo(
    () => (characterClass ? getStartingEquipmentPackage(characterClass.id) : []),
    [characterClass],
  );

  /**
   * ⚡ Bolt: Memoized estimated AC calculation using pure hoisted helper.
   * Moved before early return to satisfy react-hooks/rules-of-hooks.
   */
  const estimatedACValue = React.useMemo(
    () =>
      characterClass
        ? calculateEstimatedACFromEquipment(startingEquipment, character, characterClass)
        : 10,
    [startingEquipment, character, characterClass],
  );

  if (!characterClass) {
    return (
      <div className="text-center space-y-4">
        <Package className="w-16 h-16 mx-auto text-muted-foreground" aria-hidden="true" />
        <h2 className="text-2xl font-bold">Class Required</h2>
        <p className="text-muted-foreground">
          Please select a class first to determine starting equipment.
        </p>
      </div>
    );
  }

  const goldData = startingGoldByClass[characterClass.id];

  /**
   * Roll for starting gold
   */
  const rollStartingGold = (): void => {
    if (!goldData) return;

    // Simple dice roll simulation - in a real app you'd use proper dice rolling
    const dice = parseStartingGoldDice(goldData.dice);
    if (!dice) return;

    let total = 0;
    for (let i = 0; i < dice.count; i++) {
      total += Math.floor(Math.random() * dice.sides) + 1;
    }

    const finalAmount = total * goldData.multiplier;
    setRolledGold(finalAmount);
    setHasRolledGold(true);

    toast({
      title: 'Starting Gold Rolled',
      description: `Rolled ${total} × ${goldData.multiplier} = ${finalAmount} gp`,
    });
  };

  /**
   * Apply equipment selection
   */
  const applyEquipment = (): void => {
    if (method === 'package') {
      const chosen = srdEquipment.choices.flatMap(
        (choice, index) => choice.alternatives[choiceSelections[index] ?? 0]?.items ?? [],
      );
      const selectedItems = srdEquipment.choices.length
        ? [...srdEquipment.fixed, ...chosen]
        : startingEquipment.map((equipment) => ({ equipment, quantity: 1 }));
      const inventory = selectedItems.map(({ equipment, quantity }) => ({
        itemId: equipment.id,
        quantity,
        equipped: false,
      }));

      // Auto-equip appropriate items
      // ⚡ Bolt: Use EQUIPMENT_LOOKUP for O(1) retrieval in the map loop.
      const equippedInventory = inventory.map((item) => {
        const equipment = EQUIPMENT_LOOKUP.get(item.itemId);
        const shouldEquip =
          equipment &&
          (equipment.category === 'armor' ||
            equipment.category === 'shield' ||
            (equipment.category === 'weapon' &&
              inventory
                .filter((i) => {
                  const eq = EQUIPMENT_LOOKUP.get(i.itemId);
                  return eq?.category === 'weapon';
                })
                .indexOf(item) < 2)); // Equip first 2 weapons

        return { ...item, equipped: shouldEquip || false };
      });

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          inventory: equippedInventory,
          currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
        },
      });

      toast({
        title: 'Equipment Package Applied',
        description: `Received ${characterClass.name} starting equipment.`,
      });
    } else {
      if (!hasRolledGold) {
        toast({
          title: 'Roll for Gold First',
          description: 'Please roll for starting gold before proceeding.',
          variant: 'destructive',
        });
        return;
      }

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          inventory: [],
          currency: { cp: 0, sp: 0, ep: 0, gp: rolledGold, pp: 0 },
        },
      });

      toast({
        title: 'Starting Gold Applied',
        description: `Started with ${rolledGold} gp to purchase equipment.`,
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-3xl font-bold mb-2">Starting Equipment</h2>
        <p className="text-muted-foreground">
          Choose how to determine your {characterClass.name}'s starting equipment
        </p>
      </div>

      {/* Method Selection */}
      <Card>
        <CardHeader>
          <CardTitle id={titleId}>Equipment Method</CardTitle>
        </CardHeader>
        <CardContent>
          <RadioGroup
            value={method}
            onValueChange={(value: 'package' | 'gold') => setMethod(value)}
            aria-labelledby={titleId}
          >
            <div className="space-y-3">
              <div className="flex items-center space-x-2 p-4 border rounded hover:border-primary transition-colors cursor-pointer">
                <RadioGroupItem value="package" id={packageId} />
                <div className="flex-1">
                  <Label htmlFor={packageId} className="flex items-center gap-2 cursor-pointer">
                    <Package className="w-5 h-5 text-blue-500" aria-hidden="true" />
                    <div>
                      <div className="font-medium">Equipment Package</div>
                      <div className="text-sm text-muted-foreground">
                        Receive the standard {characterClass.name} equipment package
                      </div>
                    </div>
                  </Label>
                </div>
                <Badge variant="secondary">Recommended</Badge>
              </div>

              <div className="flex items-center space-x-2 p-4 border rounded hover:border-primary transition-colors cursor-pointer">
                <RadioGroupItem value="gold" id={goldId} />
                <div className="flex-1">
                  <Label htmlFor={goldId} className="flex items-center gap-2 cursor-pointer">
                    <Coins className="w-5 h-5 text-yellow-500" aria-hidden="true" />
                    <div>
                      <div className="font-medium">Starting Gold</div>
                      <div className="text-sm text-muted-foreground">
                        Roll {goldData?.dice} × {goldData?.multiplier} gp and buy your own equipment
                      </div>
                    </div>
                  </Label>
                </div>
                <Badge variant="outline">Advanced</Badge>
              </div>
            </div>
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Equipment Package Preview */}
      {method === 'package' && (
        <div className="space-y-4">
          <EquipmentPackagePreview
            className={characterClass.name}
            estimatedACValue={estimatedACValue}
            startingEquipment={startingEquipment}
          />
          {srdEquipment.choices.map((choice, index) => (
            <div key={choice.description} className="space-y-2">
              <Label htmlFor={`equipment-choice-${index}`}>{choice.description}</Label>
              <select
                id={`equipment-choice-${index}`}
                className="w-full rounded-md border bg-background p-2"
                value={choiceSelections[index] ?? 0}
                onChange={(event) =>
                  setChoiceSelections((current) => ({
                    ...current,
                    [index]: Number(event.target.value),
                  }))
                }
              >
                {choice.alternatives.map((alternative, optionIndex) => (
                  <option key={`${alternative.label}-${optionIndex}`} value={optionIndex}>
                    {alternative.label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Starting Gold Option */}
      {method === 'gold' && (
        <StartingGoldOption
          goldData={goldData}
          hasRolledGold={hasRolledGold}
          rolledGold={rolledGold}
          onRollGold={rollStartingGold}
          onResetRoll={() => {
            setHasRolledGold(false);
            setRolledGold(0);
          }}
        />
      )}

      {/* Apply Button */}
      <div className="flex justify-center">
        <Button
          onClick={applyEquipment}
          size="lg"
          disabled={method === 'gold' && !hasRolledGold}
          title={
            method === 'gold' && !hasRolledGold
              ? 'Roll for starting gold before applying'
              : 'Apply selection to your character'
          }
        >
          <TrendingUp className="w-4 h-4 mr-2" aria-hidden="true" />
          Apply {method === 'package' ? 'Equipment Package' : 'Starting Gold'}
        </Button>
      </div>
    </div>
  );
};

export default StartingEquipmentSelection;
