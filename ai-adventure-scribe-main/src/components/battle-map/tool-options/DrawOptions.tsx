import { Eye, EyeOff } from 'lucide-react';
import React from 'react';

import { ColorPicker } from './ColorPicker';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface DrawOptionsProps {
  strokeWidth: number;
  setStrokeWidth: (width: number) => void;
  strokeColor: string;
  setStrokeColor: (color: string) => void;
  fillEnabled: boolean;
  setFillEnabled: (enabled: boolean) => void;
  fillColor: string;
  setFillColor: (color: string) => void;
  fillOpacity: number;
  setFillOpacity: (opacity: number) => void;
  strokeWidthId: string;
  fillOpacityId: string;
}

export const DrawOptions: React.FC<DrawOptionsProps> = ({
  strokeWidth,
  setStrokeWidth,
  strokeColor,
  setStrokeColor,
  fillEnabled,
  setFillEnabled,
  fillColor,
  setFillColor,
  fillOpacity,
  setFillOpacity,
  strokeWidthId,
  fillOpacityId,
}) => {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={strokeWidthId} className="text-sm">
          Stroke Width
        </Label>
        <Slider
          id={strokeWidthId}
          value={[strokeWidth]}
          onValueChange={([value]) => setStrokeWidth(value)}
          min={1}
          max={20}
          step={1}
          className="w-full"
          aria-label="Stroke Width"
        />
        <span className="text-xs text-muted-foreground">{strokeWidth}px</span>
      </div>

      <ColorPicker label="Stroke Color" value={strokeColor} onChange={setStrokeColor} />

      <div className="flex items-center gap-2">
        <Button
          variant={fillEnabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFillEnabled(!fillEnabled)}
          aria-pressed={fillEnabled}
          aria-label="Toggle Fill"
          title="Toggle Fill"
        >
          {fillEnabled ? (
            <Eye className="h-4 w-4" aria-hidden="true" />
          ) : (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="ml-2">Fill</span>
        </Button>
      </div>

      {fillEnabled && (
        <>
          <ColorPicker label="Fill Color" value={fillColor} onChange={setFillColor} />

          <div className="space-y-2">
            <Label htmlFor={fillOpacityId} className="text-sm">
              Fill Opacity
            </Label>
            <Slider
              id={fillOpacityId}
              value={[fillOpacity * 100]}
              onValueChange={([value]) => setFillOpacity(value / 100)}
              min={0}
              max={100}
              step={5}
              className="w-full"
              aria-label="Fill Opacity"
            />
            <span className="text-xs text-muted-foreground">{Math.round(fillOpacity * 100)}%</span>
          </div>
        </>
      )}
    </div>
  );
};
