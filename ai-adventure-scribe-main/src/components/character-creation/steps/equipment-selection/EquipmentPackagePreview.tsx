import { Package, Shield, Sword, Shirt } from 'lucide-react';
import React from 'react';

import type { Equipment } from '@/data/equipmentOptions';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface EquipmentPackagePreviewProps {
  className: string;
  estimatedACValue: number;
  startingEquipment: Equipment[];
}

/**
 * Extracted from StartingEquipmentSelection.tsx
 * Renders the preview of the equipment package for a selected class.
 */
export const EquipmentPackagePreview: React.FC<EquipmentPackagePreviewProps> = ({
  className,
  estimatedACValue,
  startingEquipment,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="w-5 h-5 text-blue-500" aria-hidden="true" />
          {className} Equipment Package
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
                  <Shield className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
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
  );
};
