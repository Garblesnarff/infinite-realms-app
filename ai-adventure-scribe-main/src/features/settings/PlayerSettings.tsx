import { Scroll, Trophy, Volume2 } from 'lucide-react';
import React from 'react';

import { SettingSwitch } from './SettingSwitch';
import { NARRATION_SPEEDS } from './table-settings';
import { useApplyReduceMotion } from './useApplyReduceMotion';
import { useTableSettings } from './useTableSettings';
import { VOICE_RATE_KEY, VOICE_VOLUME_KEY, writeVoiceNumber } from './voice-preferences';
import { showTargetNumbersByDefault } from '../../../shared/show-target-numbers';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useOptionalCampaign } from '@/contexts/CampaignContext';
import { useShowTargetNumbers } from '@/features/game-session/hooks/use-show-target-numbers';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { userDataApi } from '@/services/user-data-api';

interface PlayerSettingsProps {
  /** Campaign the settings belong to. The hub passes its props; the gear sheet falls back to the open campaign. */
  campaignId?: string;
  rulesConfig?: Record<string, unknown>;
}

/**
 * Table, narration and gameplay settings (#1347, #106 section E, #1429). The
 * Campaign Hub Settings tab and the in-game gear sheet both render this one
 * component, so the gear opens ONE sheet with every setting on it. Level
 * Advancement renders when a campaign is known (hub props or the open campaign);
 * it is that campaign's rule, not a player preference. Show NPC Rolls renders the
 * Behind the Screen summary under the DM message that carried the rolls.
 */
export const PlayerSettings: React.FC<PlayerSettingsProps> = ({ campaignId, rulesConfig }) => {
  const { settings, updateSettings } = useTableSettings();
  const { showTargetNumbers, setShowTargetNumbers } = useShowTargetNumbers();
  useApplyReduceMotion();

  const openCampaign = useOptionalCampaign()?.state.campaign;
  const resolvedCampaignId = campaignId ?? openCampaign?.id;
  const resolvedRulesConfig = rulesConfig ?? openCampaign?.rules_config ?? {};
  // The displayed default follows the same precedence the switch itself uses
  // (useShowTargetNumbers): the campaign's rules flag wins over the difficulty
  // default. The difficulty label only names the resolved campaign — the hub
  // passes a campaign in while the context may still hold a previous one.
  const sameCampaign = openCampaign != null && openCampaign.id === resolvedCampaignId;
  const difficulty = sameCampaign ? openCampaign.difficulty_level : undefined;
  const rulesTargetNumbers =
    typeof resolvedRulesConfig.show_target_numbers === 'boolean'
      ? resolvedRulesConfig.show_target_numbers
      : null;
  const targetNumbersDefault = rulesTargetNumbers ?? showTargetNumbersByDefault(difficulty);
  const difficultyLabel = difficulty
    ? difficulty.charAt(0).toUpperCase() + difficulty.slice(1)
    : null;

  const setVolume = (percent: number): void => {
    const narrationVolume = Math.min(1, Math.max(0, percent / 100));
    updateSettings({ narrationVolume });
    writeVoiceNumber(VOICE_VOLUME_KEY, narrationVolume);
  };

  const setSpeed = (narrationSpeed: number): void => {
    updateSettings({ narrationSpeed });
    writeVoiceNumber(VOICE_RATE_KEY, narrationSpeed);
  };

  const volumePercent = Math.round(settings.narrationVolume * 100);

  return (
    <div className="mt-4 space-y-4">
      <Card className="p-6">
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold [body.ir-table-look_&]:text-xs [body.ir-table-look_&]:font-bold [body.ir-table-look_&]:uppercase [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:text-[#4fb6c4]">
            <Scroll className="h-5 w-5 [body.ir-table-look_&]:hidden" aria-hidden="true" />
            Table
          </h2>
          <p className="text-sm text-muted-foreground">Saved in this browser for your account.</p>
        </div>
        <div className="space-y-4">
          <SettingSwitch
            id="setting-target-numbers"
            label="Show target numbers"
            description={`Shows the DC and AC on checks and attacks. Default for this campaign: ${targetNumbersDefault ? 'on' : 'off'}${difficultyLabel ? ` (${difficultyLabel})` : ''}.`}
            checked={showTargetNumbers}
            onChange={setShowTargetNumbers}
          />
          <SettingSwitch
            id="setting-npc-rolls"
            label="Show NPC Rolls"
            description="Show the Behind the Screen summary of NPC rolls under the DM message that carried them."
            checked={settings.showNPCRolls}
            onChange={(checked) => updateSettings({ showNPCRolls: checked })}
          />
          <SettingSwitch
            id="setting-dice-sound"
            label="Dice sound"
            description="Plays a sound when the dice land."
            checked={settings.diceSound}
            onChange={(checked) => updateSettings({ diceSound: checked })}
          />
          {/* Board draws a binary switch; the stored 'off' (opt out of the OS
              reduced-motion setting) is no longer settable here. Toggling the
              switch on then off writes 'system' — see the test pinning this. */}
          <SettingSwitch
            id="setting-reduce-motion"
            label="Reduce motion"
            description="Dice show the result at once. Your device setting also applies."
            checked={settings.reduceMotion === 'on'}
            onChange={(checked) => updateSettings({ reduceMotion: checked ? 'on' : 'system' })}
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold [body.ir-table-look_&]:text-xs [body.ir-table-look_&]:font-bold [body.ir-table-look_&]:uppercase [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:text-[#4fb6c4]">
            <Volume2 className="h-5 w-5 [body.ir-table-look_&]:hidden" aria-hidden="true" />
            Narration
          </h2>
          <p className="text-sm text-muted-foreground">Saved in this browser for your account.</p>
        </div>
        <div className="space-y-4">
          <SettingSwitch
            id="setting-narration-auto-play"
            label="Read new DM messages aloud"
            description="Starts the voice when a message arrives."
            checked={settings.narrationAutoPlay}
            onChange={(checked) => updateSettings({ narrationAutoPlay: checked })}
          />
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <Label htmlFor="narration-volume" className="text-base font-medium">
                Volume
              </Label>
              <span className="text-base font-normal text-muted-foreground [body.ir-table-look_&]:!text-[#aab3cc]">
                {volumePercent}%
              </span>
            </div>
            <input
              id="narration-volume"
              className="mt-3 block w-full min-h-11"
              type="range"
              min={0}
              max={100}
              value={volumePercent}
              onChange={(event) => setVolume(Number(event.target.value))}
            />
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div
              id="narration-speed-label"
              className="text-base font-medium [body.ir-table-look_&]:font-bold"
            >
              Speed
            </div>
            <p className="text-sm text-muted-foreground">How fast narration plays.</p>
            <div
              role="radiogroup"
              aria-labelledby="narration-speed-label"
              className="mt-3 flex gap-2"
            >
              {NARRATION_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  role="radio"
                  aria-checked={settings.narrationSpeed === speed}
                  onClick={() => setSpeed(speed)}
                  className={`min-h-11 flex-1 rounded-[10px] border px-2 text-sm font-medium ${
                    settings.narrationSpeed === speed
                      ? 'border-infinite-gold bg-infinite-gold/15 text-infinite-gold'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {speed}×
                </button>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {resolvedCampaignId && (
        <LevelAdvancementCard
          key={resolvedCampaignId}
          campaignId={resolvedCampaignId}
          rulesConfig={resolvedRulesConfig}
        />
      )}
    </div>
  );
};

/** Level Advancement for one campaign, moved here from CampaignSettings (#1429). */
const LevelAdvancementCard: React.FC<{
  campaignId: string;
  rulesConfig: Record<string, unknown>;
}> = ({ campaignId, rulesConfig }) => {
  const [levelingMode, setLevelingMode] = useLocalStorage<'xp' | 'milestone'>(
    `game:levelingMode:${campaignId}`,
    rulesConfig.levelingMode === 'milestone' ? 'milestone' : 'xp',
  );
  const changeLevelingMode = async (mode: 'xp' | 'milestone'): Promise<void> => {
    setLevelingMode(mode);
    await userDataApi.updateCampaign(campaignId, {
      rules_config: { ...rulesConfig, levelingMode: mode },
    });
  };

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold [body.ir-table-look_&]:text-xs [body.ir-table-look_&]:font-bold [body.ir-table-look_&]:uppercase [body.ir-table-look_&]:tracking-[0.14em] [body.ir-table-look_&]:text-[#4fb6c4]">
          <Trophy className="h-5 w-5 [body.ir-table-look_&]:hidden" aria-hidden="true" />
          Gameplay
        </h2>
      </div>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 min-h-11">
        <div className="space-y-1">
          <Label htmlFor="leveling-mode" className="flex items-center gap-2 text-base font-medium">
            Level Advancement
          </Label>
          <p className="text-sm text-muted-foreground">
            This campaign only. XP tracks earned experience. Milestone hides XP and lets the DM
            trigger level-ups.
          </p>
        </div>
        <select
          id="leveling-mode"
          className="min-h-11 rounded-md border bg-background p-2"
          value={levelingMode}
          onChange={(event) => void changeLevelingMode(event.target.value as 'xp' | 'milestone')}
        >
          <option value="xp">Experience Points</option>
          <option value="milestone">Milestone</option>
        </select>
      </div>
    </Card>
  );
};
