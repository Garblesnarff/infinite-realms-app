import { Package, Coins, Dice1, TrendingUp, Shield, Sword, Shirt } from 'lucide-react';
import React, { useState, useId } from 'react';

import type { Equipment } from '@/data/equipmentOptions';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { useCharacter } from '@/contexts/CharacterContext';
import { startingGoldByClass, allEquipment, calculateArmorClass } from '@/data/equipmentOptions';

/**
 * ⚡ Bolt: Static equipment lookup map for O(1) performance.
 * Replaces O(N) linear searches during equipment processing.
 */
const EQUIPMENT_LOOKUP = new Map(allEquipment.map((eq) => [eq.id, eq]));

/**
 * ⚡ Bolt: Class-based starting equipment packages hoisted to prevent re-allocation.
 */
const STARTING_PACKAGES: Record<string, string[]> = {
  fighter: [
    'chain-mail',
    'shield',
    'longsword',
    'handaxe',
    'handaxe',
    'light-crossbow',
    'explorers-pack',
  ],
  wizard: ['dagger', 'quarterstaff', 'component-pouch', 'scholars-pack', 'spellbook'],
  rogue: ['leather-armor', 'shortsword', 'shortsword', 'thieves-tools', 'shortbow', 'burglars-pack'],
  cleric: ['chain-shirt', 'shield', 'mace', 'light-crossbow', 'priests-pack', 'holy-symbol'],
  barbarian: ['leather-armor', 'shield', 'handaxe', 'handaxe', 'javelin', 'javelin', 'explorers-pack'],
  bard: ['leather-armor', 'dagger', 'rapier', 'lute', 'entertainers-pack'],
  druid: ['leather-armor', 'shield', 'scimitar', 'shield', 'explorers-pack', 'druidcraft-focus'],
  monk: [
    'shortsword',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'dart',
    'explorers-pack',
  ],
  paladin: [
    'chain-mail',
    'shield',
    'longsword',
    'javelin',
    'javelin',
    'javelin',
    'javelin',
    'javelin',
    'priests-pack',
    'holy-symbol',
  ],
  ranger: ['leather-armor', 'shortsword', 'shortsword', 'longbow', 'explorers-pack'],
  sorcerer: ['dagger', 'dagger', 'component-pouch', 'light-crossbow', 'dungeoneer-pack'],
  warlock: ['leather-armor', 'dagger', 'simple-weapon', 'light-crossbow', 'scholars-pack'],
};

/**
 * ⚡ Bolt: Pure helper function to get starting equipment package.
 */
const getStartingEquipmentPackage = (classId: string): Equipment[] => {
  const equipmentIds = STARTING_PACKAGES[classId] || [];
  return equipmentIds.map((id) => {
    const item = EQUIPMENT_LOOKUP.get(id);
    return (
      item || {
        id,
        name: id.replace('-', ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        category: 'gear' as const,
        cost: { amount: 0, currency: 'gp' as const },
        description: `Starting ${classId} equipment`,
      }
    );
  });
};

/**
 * ⚡ Bolt: Pure helper to calculate estimated AC from equipment.
 */
const calculateEstimatedACFromEquipment = (
  startingEquipment: Equipment[],
  character: {
    abilityScores?: {
      dexterity?: { modifier: number };
      constitution?: { modifier: number };
      wisdom?: { modifier: number };
    };
  } | null,
  characterClass: { name: string },
): number => {
  const armor = startingEquipment.find((eq) => eq.category === 'armor');
  const shield = startingEquipment.find((eq) => eq.category === 'shield');
  const dexMod = character?.abilityScores?.dexterity?.modifier || 0;
  const conMod = character?.abilityScores?.constitution?.modifier || 0;
  const wisMod = character?.abilityScores?.wisdom?.modifier || 0;

  return calculateArmorClass(
    armor || null,
    shield || null,
    dexMod,
    0, // otherBonuses
    characterClass.name,
    conMod,
    wisMod,
  );
};

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
    const numDice = parseInt(goldData.dice.split('d')[0]);
    const dieSize = parseInt(goldData.dice.split('d')[1]);

    let total = 0;
    for (let i = 0; i < numDice; i++) {
      total += Math.floor(Math.random() * dieSize) + 1;
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
      const inventory = startingEquipment.map((equipment, _index) => ({
        itemId: equipment.id,
        quantity: 1,
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
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-blue-500" aria-hidden="true" />
              {characterClass.name} Equipment Package
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="text-center p-3 border rounded">
                <div className="text-2xl font-bold text-blue-600">{estimatedACValue}</div>
                <div className="text-xs text-muted-foreground">Estimated AC</div>
              </div>
              <div className="text-center p-3 border rounded">
                <div className="text-2xl font-bold">{startingEquipment.length}</div>
                <div className="text-xs text-muted-foreground">Items Included</div>
              </div>
              <div className="text-center p-3 border rounded">
                <div className="text-2xl font-bold">0</div>
                <div className="text-xs text-muted-foreground">Starting Gold</div>
              </div>
            </div>

            <Separator className="mb-4" />

            <div className="space-y-3">
              <h4 className="font-medium">Equipment Included:</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {startingEquipment.map((equipment, index) => (
                  <div key={index} className="flex items-center gap-2 p-2 border rounded text-sm">
                    {equipment.category === 'weapon' && (
                      <Sword className="w-4 h-4 text-red-500" aria-hidden="true" />
                    )}
                    {equipment.category === 'armor' && (
                      <Shirt className="w-4 h-4 text-blue-500" aria-hidden="true" />
                    )}
                    {equipment.category === 'shield' && (
                      <Shield className="w-4 h-4 text-gray-500" aria-hidden="true" />
                    )}
                    {!['weapon', 'armor', 'shield'].includes(equipment.category) && (
                      <Package className="w-4 h-4 text-green-500" aria-hidden="true" />
                    )}
                    <span>{equipment.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Starting Gold Option */}
      {method === 'gold' && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="w-5 h-5 text-yellow-500" aria-hidden="true" />
              Starting Gold
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center space-y-4">
              <div className="p-6 border-2 border-dashed rounded-lg">
                <Dice1 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" aria-hidden="true" />
                <div className="text-lg font-medium mb-2">
                  Roll {goldData?.dice} × {goldData?.multiplier}
                </div>
                <div className="text-sm text-muted-foreground mb-4">
                  Average: {goldData?.average} gp
                </div>

                {hasRolledGold ? (
                  <div className="space-y-2">
                    <div className="text-3xl font-bold text-yellow-600">{rolledGold} gp</div>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setHasRolledGold(false);
                        setRolledGold(0);
                      }}
                    >
                      Roll Again
                    </Button>
                  </div>
                ) : (
                  <Button onClick={rollStartingGold} size="lg">
                    <Dice1 className="w-4 h-4 mr-2" aria-hidden="true" />
                    Roll for Gold
                  </Button>
                )}
              </div>

              <div className="text-sm text-muted-foreground">
                With starting gold, you'll need to purchase all equipment from the shop. This allows
                for complete customization but requires more planning.
              </div>
            </div>
          </CardContent>
        </Card>
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
