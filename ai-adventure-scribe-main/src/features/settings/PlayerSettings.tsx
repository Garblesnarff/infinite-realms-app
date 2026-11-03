import { Scroll, Volume2 } from 'lucide-react';
import React from 'react';

import { SettingSwitch } from './SettingSwitch';
import { NARRATION_SPEEDS } from './table-settings';
import { useApplyReduceMotion } from './useApplyReduceMotion';
import { useTableSettings } from './useTableSettings';
import { VOICE_RATE_KEY, VOICE_VOLUME_KEY, writeVoiceNumber } from './voice-preferences';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useShowTargetNumbers } from '@/features/game-session/hooks/use-show-target-numbers';

/**
 * Table and narration settings (#1347, #106 section E). The Campaign Hub Settings
 * tab and the in-game gear sheet both render this. Level Advancement stays on the
 * hub, because it belongs to one campaign. Show NPC Rolls is not here: nothing reads it.
 */
export const PlayerSettings: React.FC = () => {
  const { settings, updateSettings } = useTableSettings();
  const { showTargetNumbers, setShowTargetNumbers } = useShowTargetNumbers();
  useApplyReduceMotion();

  const setVolume = (percent: number): void => {
    const narrationVolume = Math.min(1, Math.max(0, percent / 100));
    updateSettings({ narrationVolume });
    writeVoiceNumber(VOICE_VOLUME_KEY, narrationVolume);
  };

  const setSpeed = (narrationSpeed: number): void => {
    updateSettings({ narrationSpeed });
    writeVoiceNumber(VOICE_RATE_KEY, narrationSpeed);
  };

  return (
    <div className="mt-4 space-y-4">
      <Card className="p-6">
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold">
            <Scroll className="h-5 w-5" aria-hidden="true" />
            Table
          </h2>
          <p className="text-sm text-muted-foreground">Saved in this browser for your account.</p>
        </div>
        <div className="space-y-4">
          <SettingSwitch
            id="setting-target-numbers"
            label="Show target numbers"
            description="Show armor class and save difficulty on engine cards. Your choice here is the one the header button uses."
            checked={showTargetNumbers}
            onChange={setShowTargetNumbers}
          />
          <SettingSwitch
            id="setting-dice-sound"
            label="Dice sound"
            description="Play a sound when dice are rolled."
            checked={settings.diceSound}
            onChange={(checked) => updateSettings({ diceSound: checked })}
          />
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 min-h-11">
            <div className="space-y-1">
              <Label htmlFor="reduce-motion" className="text-base font-medium">
                Reduce motion
              </Label>
              <p className="text-sm text-muted-foreground">
                Follow this device, or choose Reduce or Allow.
              </p>
            </div>
            <select
              id="reduce-motion"
              className="min-h-11 rounded-md border bg-background p-2"
              value={settings.reduceMotion}
              onChange={(event) =>
                updateSettings({
                  reduceMotion: event.target.value as 'system' | 'on' | 'off',
                })
              }
            >
              <option value="system">System</option>
              <option value="on">Reduce</option>
              <option value="off">Allow</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold">
            <Volume2 className="h-5 w-5" aria-hidden="true" />
            Narration
          </h2>
          <p className="text-sm text-muted-foreground">Saved in this browser for your account.</p>
        </div>
        <div className="space-y-4">
          <SettingSwitch
            id="setting-narration-auto-play"
            label="Auto-play"
            description="Off until you turn it on. Story lines still wait for Listen."
            checked={settings.narrationAutoPlay}
            onChange={(checked) => updateSettings({ narrationAutoPlay: checked })}
          />
          <div className="rounded-lg border border-border bg-card p-4">
            <Label htmlFor="narration-volume" className="text-base font-medium">
              Volume
            </Label>
            <input
              id="narration-volume"
              className="mt-3 block w-full min-h-11"
              type="range"
              min={0}
              max={100}
              value={Math.round(settings.narrationVolume * 100)}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 min-h-11">
            <div className="space-y-1">
              <Label htmlFor="narration-speed" className="text-base font-medium">
                Speed
              </Label>
              <p className="text-sm text-muted-foreground">How fast narration plays.</p>
            </div>
            <select
              id="narration-speed"
              className="min-h-11 rounded-md border bg-background p-2"
              value={String(settings.narrationSpeed)}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {NARRATION_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>
    </div>
  );
};
