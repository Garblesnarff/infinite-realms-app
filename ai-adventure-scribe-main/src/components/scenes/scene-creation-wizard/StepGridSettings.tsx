import React, { useId } from 'react';

import { readBoundedInteger } from './bounded-number-input';

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
  const squareId = useId();
  const hexHId = useId();
  const hexVId = useId();
  const gridlessId = useId();
  const gridSizeId = useId();
  const gridColorId = useId();

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
              <RadioGroupItem value={GridType.SQUARE} id={squareId} />
              <Label htmlFor={squareId} className="flex-1 cursor-pointer">
                <div className="font-medium">Square Grid</div>
                <div className="text-sm text-muted-foreground">Classic D&D grid</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.HEXAGONAL_HORIZONTAL} id={hexHId} />
              <Label htmlFor={hexHId} className="flex-1 cursor-pointer">
                <div className="font-medium">Hex (Horizontal)</div>
                <div className="text-sm text-muted-foreground">Flat-topped hexagons</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.HEXAGONAL_VERTICAL} id={hexVId} />
              <Label htmlFor={hexVId} className="flex-1 cursor-pointer">
                <div className="font-medium">Hex (Vertical)</div>
                <div className="text-sm text-muted-foreground">Point-topped hexagons</div>
              </Label>
            </div>

            <div className="flex items-center space-x-2 border rounded-lg p-4 cursor-pointer hover:bg-muted/50">
              <RadioGroupItem value={GridType.GRIDLESS} id={gridlessId} />
              <Label htmlFor={gridlessId} className="flex-1 cursor-pointer">
                <div className="font-medium">Gridless</div>
                <div className="text-sm text-muted-foreground">No grid overlay</div>
              </Label>
            </div>
          </div>
        </RadioGroup>
      </div>

      <div className="space-y-2">
        <Label htmlFor={gridSizeId}>Grid Size (feet per square) *</Label>
        <Input
          id={gridSizeId}
          type="number"
          min="1"
          max="50"
          value={gridSize}
          onChange={(e) => onUpdate({ gridSize: readBoundedInteger(e.target.value, 1, 50) })}
        />
        <p className="text-xs text-muted-foreground">
          Common values: 5ft (standard), 10ft (large scale)
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={gridColorId}>Grid Color</Label>
        <div className="flex items-center gap-3">
          <Input
            id={gridColorId}
            type="color"
            value={gridColor}
            onChange={(e) => onUpdate({ gridColor: e.target.value })}
            className="w-20 h-10"
            aria-label="Grid color picker"
          />
          <Input
            type="text"
            value={gridColor}
            onChange={(e) => onUpdate({ gridColor: e.target.value })}
            placeholder="#000000"
            maxLength={7}
            aria-label="Grid color hex code"
          />
        </div>
      </div>
    </div>
  );
};
