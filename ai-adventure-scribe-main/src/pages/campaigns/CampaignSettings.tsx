import React from 'react';

import { PlayerSettings } from '@/features/settings/PlayerSettings';

interface CampaignSettingsProps {
  campaignId: string;
  rulesConfig: Record<string, unknown>;
}

/**
 * Campaign Hub Settings tab. Table, narration and Level Advancement come from
 * PlayerSettings, the same component the in-game gear sheet renders, so the gear
 * opens ONE sheet with every setting on it (#1429). Level Advancement is this
 * campaign's rule, not a player preference, so the hub passes the campaign in
 * and the card renders from it. Show NPC Rolls is a Table switch in PlayerSettings.
 */
const CampaignSettings: React.FC<CampaignSettingsProps> = ({ campaignId, rulesConfig }) => {
  return (
    <div className="space-y-4">
      <PlayerSettings campaignId={campaignId} rulesConfig={rulesConfig} />
    </div>
  );
};

export default CampaignSettings;
