import React from 'react';

import { SceneSettings } from '../SceneSettings';

interface StepSceneSettingsUpdates {
  enableFogOfWar?: boolean;
  enableDynamicLighting?: boolean;
  snapToGrid?: boolean;
  gridOpacity?: string;
  ambientLightLevel?: string;
  darknessLevel?: string;
  weatherEffects?: string;
  timeOfDay?: string;
}

interface StepSceneSettingsProps {
  enableFogOfWar: boolean;
  enableDynamicLighting: boolean;
  snapToGrid: boolean;
  gridOpacity: string;
  ambientLightLevel: string;
  darknessLevel: string;
  weatherEffects: string;
  timeOfDay: string;
  onUpdate: (updates: StepSceneSettingsUpdates) => void;
}

export const StepSceneSettings: React.FC<StepSceneSettingsProps> = ({
  enableFogOfWar,
  enableDynamicLighting,
  snapToGrid,
  gridOpacity,
  ambientLightLevel,
  darknessLevel,
  weatherEffects,
  timeOfDay,
  onUpdate,
}) => {
  return (
    <SceneSettings
      settings={{
        enableFogOfWar,
        enableDynamicLighting,
        snapToGrid,
        gridOpacity,
        ambientLightLevel,
        darknessLevel,
        weatherEffects: weatherEffects || undefined,
        timeOfDay: timeOfDay || undefined,
      }}
      onChange={(settings) => onUpdate(settings as StepSceneSettingsUpdates)}
    />
  );
};
