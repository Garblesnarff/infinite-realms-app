import { RotateCw, Grid, Move, ZoomIn } from 'lucide-react';
import React, { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface MapAdjustmentControlsProps {
  scale: number[];
  setScale: (value: number[]) => void;
  offsetX: number[];
  setOffsetX: (value: number[]) => void;
  offsetY: number[];
  setOffsetY: (value: number[]) => void;
  rotation: number;
  setRotation: React.Dispatch<React.SetStateAction<number>>;
  showGrid: boolean;
  setShowGrid: (value: boolean) => void;
}

export const MapAdjustmentControls: React.FC<MapAdjustmentControlsProps> = ({
  scale,
  setScale,
  offsetX,
  setOffsetX,
  offsetY,
  setOffsetY,
  rotation,
  setRotation,
  showGrid,
  setShowGrid,
}) => {
  const scaleId = useId();
  const offsetXId = useId();
  const offsetYId = useId();

  const handleRotate = (): void => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleReset = (): void => {
    setScale([100]);
    setOffsetX([0]);
    setOffsetY([0]);
    setRotation(0);
  };

  return (
    <Card variant="parchment">
      <CardContent className="p-6 space-y-6">
        <div className="flex items-center justify-between mb-4">
          <h4 className="font-semibold">Image Adjustments</h4>
          <div className="flex gap-2" role="group" aria-label="Image adjustment tools">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGrid(!showGrid)}
              aria-pressed={showGrid}
            >
              <Grid className="mr-2 h-4 w-4" />
              {showGrid ? 'Hide Grid' : 'Show Grid'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRotate}>
              <RotateCw className="mr-2 h-4 w-4" />
              Rotate
            </Button>
          </div>
        </div>

        {/* Scale */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={scaleId} className="flex items-center gap-2">
              <ZoomIn className="h-4 w-4" />
              Scale
            </Label>
            <span className="text-sm text-muted-foreground">{scale[0]}%</span>
          </div>
          <Slider
            id={scaleId}
            value={scale}
            onValueChange={setScale}
            min={10}
            max={200}
            step={1}
            aria-label="Scale percentage"
            getAriaValueText={(value) => `${value}%`}
          />
        </div>

        {/* Offset X */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={offsetXId} className="flex items-center gap-2">
              <Move className="h-4 w-4" />
              Horizontal Offset
            </Label>
            <span className="text-sm text-muted-foreground">{offsetX[0]}px</span>
          </div>
          <Slider
            id={offsetXId}
            value={offsetX}
            onValueChange={setOffsetX}
            min={-500}
            max={500}
            step={1}
            aria-label="Horizontal offset in pixels"
            getAriaValueText={(value) => `${value}px`}
          />
        </div>

        {/* Offset Y */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={offsetYId} className="flex items-center gap-2">
              <Move className="h-4 w-4" />
              Vertical Offset
            </Label>
            <span className="text-sm text-muted-foreground">{offsetY[0]}px</span>
          </div>
          <Slider
            id={offsetYId}
            value={offsetY}
            onValueChange={setOffsetY}
            min={-500}
            max={500}
            step={1}
            aria-label="Vertical offset in pixels"
            getAriaValueText={(value) => `${value}px`}
          />
        </div>

        {/* Rotation Display */}
        <div className="bg-muted/50 p-3 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Rotation:</span>
            <span className="text-muted-foreground">{rotation}°</span>
          </div>
        </div>

        {/* Reset Button */}
        <Button variant="outline" className="w-full" onClick={handleReset}>
          Reset Adjustments
        </Button>
      </CardContent>
    </Card>
  );
};
