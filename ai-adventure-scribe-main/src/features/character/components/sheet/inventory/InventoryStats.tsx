import { Zap } from 'lucide-react';
import React from 'react';

import type { Equipment } from '@/data/equipmentOptions';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface InventoryStatsProps {
  calculatedAC: number;
  equippedArmor: Equipment | null;
  equippedShield: Equipment | null;
  totalWeight: number;
  carryingCapacity: number;
  equippedWeaponsCount: number;
}

export const InventoryStats: React.FC<InventoryStatsProps> = ({
  calculatedAC,
  equippedArmor,
  equippedShield,
  totalWeight,
  carryingCapacity,
  equippedWeaponsCount,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-blue-500" />
          Combat Stats
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold text-blue-600">{calculatedAC}</div>
            <div className="text-xs text-muted-foreground">Armor Class</div>
            <div className="text-xs text-muted-foreground mt-1">
              {equippedArmor && `${equippedArmor.name}`}
              {equippedShield && ` + Shield`}
            </div>
          </div>
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{totalWeight}</div>
            <div className="text-xs text-muted-foreground">Weight (lbs)</div>
            <div className="text-xs text-muted-foreground">Capacity: {carryingCapacity}</div>
          </div>
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{equippedWeaponsCount}</div>
            <div className="text-xs text-muted-foreground">Equipped Weapons</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
