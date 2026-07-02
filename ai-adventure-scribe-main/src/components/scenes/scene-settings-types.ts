export interface SceneSettingsData {
  enableFogOfWar?: boolean;
  enableDynamicLighting?: boolean;
  snapToGrid?: boolean;
  gridOpacity?: string;
  ambientLightLevel?: string;
  darknessLevel?: string;
  weatherEffects?: string;
  timeOfDay?: string;
}

export type UpdateSceneSetting = (
  key: keyof SceneSettingsData,
  value: SceneSettingsData[keyof SceneSettingsData],
) => void;
