import React from 'react';

import type { SceneSettingsData } from './scene-settings-types';

import { Card, CardContent } from '@/components/ui/card';

interface SceneSettingsSummaryCardProps {
  settings: SceneSettingsData;
}

export const SceneSettingsSummaryCard: React.FC<SceneSettingsSummaryCardProps> = ({ settings }) => (
  <Card variant="glass">
    <CardContent className="pt-6">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-muted-foreground mb-1">Fog of War</p>
          <p className="font-medium">{settings.enableFogOfWar ? 'Enabled' : 'Disabled'}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Dynamic Lighting</p>
          <p className="font-medium">{settings.enableDynamicLighting ? 'Enabled' : 'Disabled'}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Grid Snap</p>
          <p className="font-medium">{settings.snapToGrid ? 'On' : 'Off'}</p>
        </div>
        <div>
          <p className="text-muted-foreground mb-1">Time</p>
          <p className="font-medium capitalize">{settings.timeOfDay || 'Day'}</p>
        </div>
      </div>
    </CardContent>
  </Card>
);
