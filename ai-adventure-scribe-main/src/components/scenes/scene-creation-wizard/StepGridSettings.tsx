import React, { useId } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { GridType } from '@/types/scene';

interface StepGridSettingsProps {
  gridType: GridType;
  gridSize: number;
  gridColor: string;
  onUpdate: (updates: { gridType?: GridType; gridSize?: number; gridColor?: string }) => void;
}

export const StepGridSettings: React.FC<StepGridSettingsProps> = ({
  gridType,
  gridSize,
  gridColor,
  onUpdate,
}) => {
  const gridTypeLabelId = useId();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Label id={gridTypeLabelId}>Grid Type *</Label>
        <RadioGroup
          value={gridType}
          onValueChange={(value) => onUpdate({ gridType: value as GridType })}
          aria-labelledby={gridTypeLabelId}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.SQUARE} id="grid-square" />
              <Label htmlFor="grid-square" className="flex-1 cursor-pointer">
                <div className="font-medium">Square Grid</div>
                <div className="text-sm text-muted-foreground">Classic D&D grid</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.HEXAGONAL_HORIZONTAL} id="grid-hex-h" />
              <Label htmlFor="grid-hex-h" className="flex-1 cursor-pointer">
                <div className="font-medium">Hex (Horizontal)</div>
                <div className="text-sm text-muted-foreground">Flat-topped hexagons</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.HEXAGONAL_VERTICAL} id="grid-hex-v" />
              <Label htmlFor="grid-hex-v" className="flex-1 cursor-pointer">
                <div className="font-medium">Hex (Vertical)</div>
                <div className="text-sm text-muted-foreground">Point-topped hexagons</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.GRIDLESS} id="grid-none" />
              <Label htmlFor="grid-none" className="flex-1 cursor-pointer">
                <div className="font-medium">Gridless</div>
                <div className="text-sm text-muted-foreground">No grid overlay</div>
              </Label>
            </div>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor="grid-size">Grid Size (feet per square) *</Label>
        <Input
          id="grid-size"
          type="number"
          min="1"
          max="50"
          value={gridSize}
          onChange={(e) => onUpdate({ gridSize: parseInt(e.target.value) || 1 })}
        />
        <p className="text-xs text-muted-foreground">
          Common values: 5ft (standard), 10ft (large scale)
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="grid-color">Grid Color</Label>
        <div className="flex items-center gap-3">
          <Input
            id="grid-color"
            type="color"
            value={gridColor}
            onChange={(e) => onUpdate({ gridColor: e.target.value })}
            className="w-20 h-10"
          />
          <Input
            type="text"
            value={gridColor}
            onChange={(e) => onUpdate({ gridColor: e.target.value })}
            placeholder="#000000"
            maxLength={7}
          />
        </div>
      </div>
    </div>
  );
};
