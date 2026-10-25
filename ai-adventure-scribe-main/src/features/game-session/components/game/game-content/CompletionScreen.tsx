import React from 'react';

import { CampaignEndState } from './CampaignEndState';

interface CampaignCompleteEndStateProps {
  /** Name of the player character who finished the adventure, when known. */
  characterName?: string | null;
  /** Campaign display name. */
  campaignName?: string | null;
  /** The stored ending summary from the completed one-shot session. */
  summary?: string | null;
  /** Route back into this campaign with a new hero. */
  chooseHeroHref: string;
  /** Wait while the starter-campaign route is resolving. */
  chooseHeroPending?: boolean;
  /** Read-only session log rendered inside the end state. */
  storyContent?: React.ReactNode;
}

export const CampaignCompleteEndState: React.FC<CampaignCompleteEndStateProps> = ({
  characterName,
  campaignName,
  summary,
  chooseHeroHref,
  chooseHeroPending,
  storyContent,
}) => (
  <CampaignEndState
    mode="complete"
    characterName={characterName}
    campaignName={campaignName}
    summary={summary}
    chooseHeroHref={chooseHeroHref}
    chooseHeroPending={chooseHeroPending}
    storyContent={storyContent}
  />
);
