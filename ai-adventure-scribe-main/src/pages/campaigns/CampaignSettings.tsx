import { Trophy } from 'lucide-react';
import React from 'react';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PlayerSettings } from '@/features/settings/PlayerSettings';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { userDataApi } from '@/services/user-data-api';

interface CampaignSettingsProps {
  campaignId: string;
  rulesConfig: Record<string, unknown>;
}

/**
 * Campaign Hub Settings tab. Table and narration come from PlayerSettings, the same
 * component the in-game gear sheet renders. Level Advancement stays here: it is
 * this campaign's rule, not a player preference. Show NPC Rolls stays off the page.
 */
const CampaignSettings: React.FC<CampaignSettingsProps> = ({ campaignId, rulesConfig }) => {
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
    <div className="space-y-4">
      <PlayerSettings />

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
