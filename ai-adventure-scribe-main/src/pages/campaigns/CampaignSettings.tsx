import { Scroll, Trophy } from 'lucide-react';
import React from 'react';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useTableSettings } from '@/features/settings/useTableSettings';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { cn } from '@/lib/utils';
import { userDataApi } from '@/services/user-data-api';

interface CampaignSettingsProps {
  campaignId: string;
  rulesConfig: Record<string, unknown>;
}

interface SettingSwitchProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/** One on/off row. The switch is 44 px tall so the whole row is a usable tap target. */
const SettingSwitch: React.FC<SettingSwitchProps> = ({
  id,
  label,
  description,
  checked,
  onChange,
}) => (
  <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 min-h-11">
    <div className="flex-1 space-y-1">
      <Label htmlFor={id} className="cursor-pointer text-base font-medium">
        {label}
      </Label>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-infinite-gold' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform',
          checked ? 'translate-x-7' : 'translate-x-1',
        )}
      />
    </button>
  </div>
);

/**
 * Settings page for the Campaign Hub. Only settings with a game reader are shown:
 * Dice sound (DiceRollEmbed) and Level Advancement (campaign). The others
 * (target numbers, narration auto-play, motion, NPC rolls) are hidden until their readers ship.
 */
const CampaignSettings: React.FC<CampaignSettingsProps> = ({ campaignId, rulesConfig }) => {
  const { settings, updateSettings } = useTableSettings();
  const [levelingMode, setLevelingMode] = useLocalStorage<'xp' | 'milestone'>(
    `game:levelingMode:${campaignId}`,
    rulesConfig.levelingMode === 'milestone' ? 'milestone' : 'xp',
  );
  const changeLevelingMode = async (mode: 'xp' | 'milestone') => {
    setLevelingMode(mode);
    await userDataApi.updateCampaign(campaignId, {
      rules_config: { ...rulesConfig, levelingMode: mode },
    });
  };

  return (
    <div className="mt-4 space-y-4">
      <Card className="p-6">
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold">
            <Scroll className="h-5 w-5" />
            Table
          </h2>
          <p className="text-sm text-muted-foreground">Saved in this browser for your account.</p>
        </div>

        <div className="space-y-4">
          <SettingSwitch
            id="setting-dice-sound"
            label="Dice sound"
            description="Play a sound when dice are rolled."
            checked={settings.diceSound}
            onChange={(checked) => updateSettings({ diceSound: checked })}
          />
        </div>
      </Card>

      <Card className="p-6">
        <div className="mb-6">
          <h2 className="mb-2 flex items-center gap-2 text-xl font-semibold">
            <Trophy className="h-5 w-5" />
            Gameplay
          </h2>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 min-h-11">
          <div className="space-y-1">
            <Label
              htmlFor="leveling-mode"
              className="flex items-center gap-2 text-base font-medium"
            >
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
    </div>
  );
};

export default CampaignSettings;
