import { Lock, Unlock } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface WallOptionsProps {
  wallType: 'solid' | 'door' | 'window' | 'terrain';
  setWallType: (type: 'solid' | 'door' | 'window' | 'terrain') => void;
  snapToGrid: boolean;
  toggleSnapToGrid: () => void;
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  wallTypeId: string;
  wallStrokeWidthId: string;
}

export const WallOptions: React.FC<WallOptionsProps> = ({
  wallType,
  setWallType,
  snapToGrid,
  toggleSnapToGrid,
  strokeWidth,
  setStrokeWidth,
  wallTypeId,
  wallStrokeWidthId,
}) => {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={wallTypeId} className="text-sm">
          Wall Type
        </Label>
        <Select
          value={wallType}
          onValueChange={(value) => setWallType(value as 'solid' | 'door' | 'window' | 'terrain')}
        >
          <SelectTrigger id={wallTypeId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid Wall</SelectItem>
            <SelectItem value="door">Door</SelectItem>
            <SelectItem value="window">Window</SelectItem>
            <SelectItem value="terrain">Terrain</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <Button
              variant={snapToGrid ? 'default' : 'outline'}
              size="sm"
              type="button"
              onClick={toggleSnapToGrid}
              aria-pressed={snapToGrid}
              aria-label="Toggle Snap to Grid"
            >
              {snapToGrid ? (
                <Lock className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Unlock className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="ml-2">Snap to Grid</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Toggle Snap to Grid</p>
          </TooltipContent>
        </Tooltip>
      </div>

      <div className="space-y-2">
        <Label htmlFor={wallStrokeWidthId} className="text-sm">
          Stroke Width
        </Label>
        <Slider
          id={wallStrokeWidthId}
          value={[strokeWidth]}
          onValueChange={([value]) => setStrokeWidth(value)}
          min={1}
          max={10}
          step={1}
          className="w-full"
          aria-label="Wall Stroke Width"
          getAriaValueText={(value) => `${value}px`}
        />
        <span className="text-xs text-muted-foreground">{strokeWidth}px</span>
      </div>
    </div>
  );
};
