import React from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface StepDimensionsProps {
  width: number;
  height: number;
  gridSize: number;
  onUpdate: (updates: { width?: number; height?: number }) => void;
}

export const StepDimensions: React.FC<StepDimensionsProps> = ({
  width,
  height,
  gridSize,
  onUpdate,
}) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-2">
          <Label htmlFor="scene-width">Width (squares) *</Label>
          <Input
            id="scene-width"
            type="number"
            min="1"
            max="100"
            value={width}
            onChange={(e) => onUpdate({ width: parseInt(e.target.value) || 1 })}
          />
          <p className="text-xs text-muted-foreground">1 - 100 squares</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="scene-height">Height (squares) *</Label>
          <Input
            id="scene-height"
            type="number"
            min="1"
            max="100"
            value={height}
            onChange={(e) => onUpdate({ height: parseInt(e.target.value) || 1 })}
          />
          <p className="text-xs text-muted-foreground">1 - 100 squares</p>
        </div>
      </div>

      <div className="bg-muted/50 p-4 rounded-lg">
        <p className="text-sm font-medium mb-2">Preview Dimensions</p>
        <p className="text-muted-foreground">
          Your scene will be{' '}
          <strong>
            {width} × {height}
          </strong>{' '}
          squares ({width * gridSize} ×{' '}
          {height * gridSize} feet)
        </p>
      </div>

      {/* Common presets */}
      <div className="space-y-2">
        <Label>Quick Presets</Label>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { name: 'Small (15×15)', w: 15, h: 15 },
            { name: 'Medium (20×20)', w: 20, h: 20 },
            { name: 'Large (30×30)', w: 30, h: 30 },
            { name: 'Huge (40×30)', w: 40, h: 30 },
          ].map((preset) => (
            <Button
              key={preset.name}
              variant="outline"
              onClick={() => onUpdate({ width: preset.w, height: preset.h })}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};
