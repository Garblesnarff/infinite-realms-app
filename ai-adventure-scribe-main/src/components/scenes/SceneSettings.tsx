/**
 * Scene Settings Component
 *
 * Settings panel for configuring scene options:
 * - Fog of war toggle
 * - Dynamic lighting toggle
 * - Grid settings (color, opacity, snap)
 * - Ambient light level slider
 * - Darkness level slider
 * - Time of day selector
 * - Weather effects input
 */

import React from 'react';

import { SceneSettingsEnvironmentCard } from './SceneSettingsEnvironmentCard';
import { SceneSettingsGridCard } from './SceneSettingsGridCard';
import { SceneSettingsLightingCard } from './SceneSettingsLightingCard';
import { SceneSettingsSummaryCard } from './SceneSettingsSummaryCard';
import { SceneSettingsVisionCard } from './SceneSettingsVisionCard';

import type { SceneSettingsData } from './scene-settings-types';

import { Button } from '@/components/ui/button';

interface SceneSettingsProps {
  settings: SceneSettingsData;
  onChange?: (settings: SceneSettingsData) => void;
  showSaveButton?: boolean;
  onSave?: () => void;
  isSaving?: boolean;
}

export const SceneSettings: React.FC<SceneSettingsProps> = ({
  settings,
  onChange,
  showSaveButton = false,
  onSave,
  isSaving = false,
}) => {
  const updateSetting = (
    key: keyof SceneSettingsData,
    value: SceneSettingsData[keyof SceneSettingsData],
  ): void => {
    onChange?.({ ...settings, [key]: value });
  };

  return (
    <div className="space-y-6">
      <SceneSettingsVisionCard settings={settings} onUpdate={updateSetting} />
      <SceneSettingsGridCard settings={settings} onUpdate={updateSetting} />
      <SceneSettingsLightingCard settings={settings} onUpdate={updateSetting} />
      <SceneSettingsEnvironmentCard settings={settings} onUpdate={updateSetting} />
      <SceneSettingsSummaryCard settings={settings} />

      {/* Save Button */}
      {showSaveButton && (
        <Button variant="cosmic" className="w-full" onClick={onSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </Button>
      )}
    </div>
  );
};
