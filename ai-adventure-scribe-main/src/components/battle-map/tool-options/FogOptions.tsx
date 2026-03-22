import { Eye, EyeOff } from 'lucide-react';
import React from 'react';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

interface FogOptionsProps {
  brushMode: 'reveal' | 'conceal';
  setBrushMode: (mode: 'reveal' | 'conceal') => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  brushModeId: string;
  brushSizeId: string;
}

export const FogOptions: React.FC<FogOptionsProps> = ({
  brushMode,
  setBrushMode,
  brushSize,
  setBrushSize,
  brushModeId,
  brushSizeId,
}) => {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={brushModeId} className="text-sm">
          Brush Mode
        </Label>
        <Select value={brushMode} onValueChange={(value: any) => setBrushMode(value)}>
          <SelectTrigger
            id={brushModeId}
            className="w-full"
            aria-label="Brush mode"
            title="Brush mode"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="reveal">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                <span>Reveal</span>
              </div>
            </SelectItem>
            <SelectItem value="conceal">
              <div className="flex items-center gap-2">
                <EyeOff className="h-4 w-4" />
                <span>Conceal</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor={brushSizeId} className="text-sm">
          Brush Size
        </Label>
        <Slider
          id={brushSizeId}
          value={[brushSize]}
          onValueChange={([value]) => setBrushSize(value)}
          min={10}
          max={200}
          step={10}
          className="w-full"
          aria-label="Brush Size"
        />
        <span className="text-xs text-muted-foreground">{brushSize}px</span>
      </div>
    </div>
  );
};
