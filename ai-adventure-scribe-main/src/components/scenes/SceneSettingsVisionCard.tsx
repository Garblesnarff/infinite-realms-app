import { Eye } from 'lucide-react';
import React, { useId } from 'react';

import type { SceneSettingsData, UpdateSceneSetting } from './scene-settings-types';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';

interface SceneSettingsVisionCardProps {
  settings: SceneSettingsData;
  onUpdate: UpdateSceneSetting;
}

export const SceneSettingsVisionCard: React.FC<SceneSettingsVisionCardProps> = ({
  settings,
  onUpdate,
}) => {
  const fogOfWarId = useId();
  const dynamicLightingId = useId();

  return (
    <Card variant="parchment">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Vision & Fog of War
        </CardTitle>
        <CardDescription>Control what players can see and how the map is revealed</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={fogOfWarId}>Fog of War</Label>
            <p className="text-xs text-muted-foreground">Hide unexplored areas from players</p>
          </div>
          <Switch
            id={fogOfWarId}
            checked={settings.enableFogOfWar ?? true}
            onCheckedChange={(checked) => onUpdate('enableFogOfWar', checked)}
          />
        </div>

        <Separator />

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor={dynamicLightingId}>Dynamic Lighting</Label>
            <p className="text-xs text-muted-foreground">
              Enable token-based vision and light sources
            </p>
          </div>
          <Switch
            id={dynamicLightingId}
            checked={settings.enableDynamicLighting ?? false}
            onCheckedChange={(checked) => onUpdate('enableDynamicLighting', checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
};
