import { Grid } from 'lucide-react';
import React, { useId } from 'react';

import type { SceneSettingsData, UpdateSceneSetting } from './scene-settings-types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

interface SceneSettingsGridCardProps {
  settings: SceneSettingsData;
  onUpdate: UpdateSceneSetting;
}

export const SceneSettingsGridCard: React.FC<SceneSettingsGridCardProps> = ({
  settings,
  onUpdate,
}) => {
  const snapToGridId = useId();
  const gridOpacityId = useId();

  // Convert string opacity to slider value (0-100)
  const gridOpacityValue = settings.gridOpacity
    ? Math.round(parseFloat(settings.gridOpacity) * 100)
    : 30;

  const handleGridOpacityChange = (value: number[]): void => {
    const opacity = (value[0] / 100).toFixed(2);
    onUpdate('gridOpacity', opacity);
  };

  return (
    <Card variant="parchment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid className="h-5 w-5" />
          Grid Settings
        </CardTitle>
        <CardDescription>Configure grid appearance and behavior</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={snapToGridId}>Snap to Grid</Label>
            <p className="text-xs text-muted-foreground">Automatically align tokens to grid</p>
          </div>
          <Switch
            id={snapToGridId}
            checked={settings.snapToGrid ?? true}
            onCheckedChange={(checked) => onUpdate('snapToGrid', checked)}
          />
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor={gridOpacityId}>Grid Opacity</Label>
            <span className="text-sm text-muted-foreground">{gridOpacityValue}%</span>
          </div>
          <Slider
            id={gridOpacityId}
            value={[gridOpacityValue]}
            onValueChange={handleGridOpacityChange}
            min={0}
            max={100}
            step={1}
            aria-label="Grid opacity percentage"
            getAriaValueText={(value) => `${value}%`}
          />
        </div>
      </CardContent>
    </Card>
  );
};
