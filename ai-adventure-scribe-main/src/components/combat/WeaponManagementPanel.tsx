/**
 * Weapon Management Panel Component
 *
 * Allows players to equip and manage their weapons during combat
 */

import { Sword, X } from 'lucide-react';
import React, { useState, useId } from 'react';

import type { Equipment } from '@/data/equipmentOptions';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCombat } from '@/contexts/CombatContext';

interface WeaponManagementPanelProps {
  participantId: string;
  inventory: Equipment[];
  mainHandWeapon?: Equipment;
  offHandWeapon?: Equipment;
}

const WeaponManagementPanel: React.FC<WeaponManagementPanelProps> = ({
  participantId,
  inventory,
  mainHandWeapon,
  offHandWeapon,
}) => {
  const { equipMainHandWeapon, equipOffHandWeapon, unequipMainHandWeapon, unequipOffHandWeapon } =
    useCombat();
  const mainHandId = useId();
  const offHandId = useId();

  const [selectedMainHand, setSelectedMainHand] = useState<string>(mainHandWeapon?.id || '');
  const [selectedOffHand, setSelectedOffHand] = useState<string>(offHandWeapon?.id || '');

  const weapons = inventory.filter((item) => item.category === 'weapon');

  const handleEquipMainHand = () => {
    if (!selectedMainHand) return;

    const weapon = weapons.find((w) => w.id === selectedMainHand);
    if (weapon) {
      equipMainHandWeapon(participantId, weapon);
    }
  };

  const handleEquipOffHand = () => {
    if (!selectedOffHand) return;

    const weapon = weapons.find((w) => w.id === selectedOffHand);
    if (weapon) {
      equipOffHandWeapon(participantId, weapon);
    }
  };

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sword className="w-5 h-5" aria-hidden="true" />
            Weapon Management
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Main Hand Weapon */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor={mainHandId}>Main Hand</Label>
              {mainHandWeapon && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        unequipMainHandWeapon(participantId);
                        setSelectedMainHand('');
                      }}
                      aria-label={`Unequip ${mainHandWeapon.name} from main hand`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Unequip {mainHandWeapon.name} from main hand</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {mainHandWeapon ? (
            <div className="p-2 bg-muted rounded">
              <div className="font-medium">{mainHandWeapon.name}</div>
              <div className="text-sm text-muted-foreground">
                {mainHandWeapon.damage?.dice} {mainHandWeapon.damage?.type}
              </div>
              {mainHandWeapon.properties && (
                <div className="text-xs text-muted-foreground">
                  {mainHandWeapon.properties.join(', ')}
                </div>
              )}
            </div>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedMainHand} onValueChange={setSelectedMainHand}>
                  <SelectTrigger id={mainHandId}>
                    <SelectValue placeholder="Select weapon" />
                  </SelectTrigger>
                  <SelectContent>
                    {weapons.map((weapon) => (
                      <SelectItem key={weapon.id} value={weapon.id}>
                        {weapon.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={handleEquipMainHand}
                  disabled={!selectedMainHand}
                >
                  Equip
                </Button>
              </div>
            )}
          </div>

          {/* Off-Hand Weapon */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label htmlFor={offHandId}>Off-Hand</Label>
              {offHandWeapon && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        unequipOffHandWeapon(participantId);
                        setSelectedOffHand('');
                      }}
                      aria-label={`Unequip ${offHandWeapon.name} from off-hand`}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Unequip {offHandWeapon.name} from off-hand</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>

            {offHandWeapon ? (
            <div className="p-2 bg-muted rounded">
              <div className="font-medium">{offHandWeapon.name}</div>
              <div className="text-sm text-muted-foreground">
                {offHandWeapon.damage?.dice} {offHandWeapon.damage?.type}
              </div>
              {offHandWeapon.properties && (
                <div className="text-xs text-muted-foreground">
                  {offHandWeapon.properties.join(', ')}
                </div>
              )}
            </div>
            ) : (
              <div className="flex gap-2">
                <Select value={selectedOffHand} onValueChange={setSelectedOffHand}>
                  <SelectTrigger id={offHandId}>
                    <SelectValue placeholder="Select weapon" />
                  </SelectTrigger>
                  <SelectContent>
                    {weapons
                      .filter(
                        (weapon) =>
                          weapon.weaponProperties?.light ||
                          weapon.weaponProperties?.finesse ||
                          weapon.name.toLowerCase().includes('dagger') ||
                          weapon.name.toLowerCase().includes('hand'),
                      )
                      .map((weapon) => (
                        <SelectItem key={weapon.id} value={weapon.id}>
                          {weapon.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={handleEquipOffHand}
                  disabled={!selectedOffHand}
                >
                  Equip
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default WeaponManagementPanel;
