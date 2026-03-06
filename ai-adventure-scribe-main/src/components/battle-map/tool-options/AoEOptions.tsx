import { Triangle, Square, Circle, Minus } from 'lucide-react';
import React from 'react';

import { ColorPicker } from './ColorPicker';

import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';

interface AoEOptionsProps {
  templateType: 'cone' | 'cube' | 'sphere' | 'line' | 'cylinder';
  setTemplateType: (type: 'cone' | 'cube' | 'sphere' | 'line' | 'cylinder') => void;
  fillColor: string;
  setFillColor: (color: string) => void;
  fillOpacity: number;
  setFillOpacity: (opacity: number) => void;
  templateTypeId: string;
  aoeOpacityId: string;
}

export const AoEOptions: React.FC<AoEOptionsProps> = ({
  templateType,
  setTemplateType,
  fillColor,
  setFillColor,
  fillOpacity,
  setFillOpacity,
  templateTypeId,
  aoeOpacityId,
}) => {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor={templateTypeId} className="text-sm">
          Template Type
        </Label>
        <Select value={templateType} onValueChange={(value: any) => setTemplateType(value)}>
          <SelectTrigger id={templateTypeId} className="w-full" aria-label="Template type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cone">
              <div className="flex items-center gap-2">
                <Triangle className="h-4 w-4" />
                <span>Cone</span>
              </div>
            </SelectItem>
            <SelectItem value="cube">
              <div className="flex items-center gap-2">
                <Square className="h-4 w-4" />
                <span>Cube</span>
              </div>
            </SelectItem>
            <SelectItem value="sphere">
              <div className="flex items-center gap-2">
                <Circle className="h-4 w-4" />
                <span>Sphere</span>
              </div>
            </SelectItem>
            <SelectItem value="line">
              <div className="flex items-center gap-2">
                <Minus className="h-4 w-4" />
                <span>Line</span>
              </div>
            </SelectItem>
            <SelectItem value="cylinder">
              <div className="flex items-center gap-2">
                <Circle className="h-4 w-4" />
                <span>Cylinder</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ColorPicker label="Template Color" value={fillColor} onChange={setFillColor} />

      <div className="space-y-2">
        <Label htmlFor={aoeOpacityId} className="text-sm">
          Opacity
        </Label>
        <Slider
          id={aoeOpacityId}
          value={[fillOpacity * 100]}
          onValueChange={([value]) => setFillOpacity(value / 100)}
          min={0}
          max={100}
          step={5}
          className="w-full"
          aria-label="Template Opacity"
        />
        <span className="text-xs text-muted-foreground">{Math.round(fillOpacity * 100)}%</span>
      </div>
    </div>
  );
};
