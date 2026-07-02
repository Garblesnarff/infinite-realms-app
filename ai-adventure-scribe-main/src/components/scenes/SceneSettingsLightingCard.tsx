import { Lightbulb } from 'lucide-react';
import React, { useId } from 'react';

import type { SceneSettingsData, UpdateSceneSetting } from './scene-settings-types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';

interface SceneSettingsLightingCardProps {
  settings: SceneSettingsData;
  onUpdate: UpdateSceneSetting;
}

export const SceneSettingsLightingCard: React.FC<SceneSettingsLightingCardProps> = ({
  settings,
  onUpdate,
}) => {
  const ambientLightId = useId();
  const darknessId = useId();

  const ambientLightValue = settings.ambientLightLevel
    ? Math.round(parseFloat(settings.ambientLightLevel) * 100)
    : 100;

  const darknessValue = settings.darknessLevel
    ? Math.round(parseFloat(settings.darknessLevel) * 100)
    : 0;

  const handleAmbientLightChange = (value: number[]): void => {
    const level = (value[0] / 100).toFixed(2);
    onUpdate('ambientLightLevel', level);
  };

  const handleDarknessChange = (value: number[]): void => {
    const level = (value[0] / 100).toFixed(2);
    onUpdate('darknessLevel', level);
  };

  return (
    <Card variant="parchment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5" />
          Lighting
        </CardTitle>
        <CardDescription>Adjust ambient light and darkness levels</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={ambientLightId}>Ambient Light Level</Label>
            <span className="text-sm text-muted-foreground">{ambientLightValue}%</span>
          </div>
          <Slider
            id={ambientLightId}
            value={[ambientLightValue]}
            onValueChange={handleAmbientLightChange}
            min={0}
            max={100}
            step={1}
            aria-label="Ambient light level percentage"
            getAriaValueText={(value) => `${value}%`}
          />
          <p className="text-xs text-muted-foreground">
            Base light level when no light sources are present
          </p>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={darknessId}>Darkness Level</Label>
            <span className="text-sm text-muted-foreground">{darknessValue}%</span>
          </div>
          <Slider
            id={darknessId}
            value={[darknessValue]}
            onValueChange={handleDarknessChange}
            min={0}
            max={100}
            step={1}
            aria-label="Darkness level percentage"
            getAriaValueText={(value) => `${value}%`}
          />
          <p className="text-xs text-muted-foreground">
            Global darkness overlay (useful for night scenes)
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
