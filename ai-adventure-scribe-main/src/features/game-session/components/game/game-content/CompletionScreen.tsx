import React from 'react';

import { CampaignEndState } from './CampaignEndState';

import { useOptionalCharacter } from '@/contexts/CharacterContext';

interface CampaignCompleteEndStateProps {
  /** Name of the player character who finished the adventure, when known. */
  characterName?: string | null;
  /** Trusted character presentation data from the owning game route. */
  portraitUrl?: string | null;
  identity?: string | null;
  experience?: number | null;
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
  portraitUrl,
  identity,
  experience,
  campaignName,
  summary,
  chooseHeroHref,
  chooseHeroPending,
  storyContent,
}) => {
  // #1084: the live end state passes no experience; read the run's XP from the loaded sheet.
  // #1161: the live screen mounts before the ending turn's sheet refresh lands
  // (the refresh is async: the ending turn dispatches character-state-updated
  // and the hook refetches), so its first render would show the pre-award
  // total. Hold the XP line until the sheet refresh lands, observed as the
  // context character object changing — SET_CHARACTER replaces the whole
  // character (#1130). The restore path passes an explicit experience prop
  // and never waits: its character was loaded at page load, after the award
  // committed. The ending turn always dispatches the refresh (use-ai-response,
  // #1161), so the wait terminates when the refetch lands; a failed refetch
  // leaves the line hidden rather than showing a known-stale number.
  const characterContext = useOptionalCharacter();
  const contextCharacter = characterContext?.state.character ?? null;
  const [mountCharacter] = React.useState(contextCharacter);
  const sheetRefreshed = experience !== undefined || contextCharacter !== mountCharacter;
  const displayExperience = sheetRefreshed
    ? (experience !== undefined
      ? experience
      : (contextCharacter?.experience ?? null))
    : null;
  return (
    <CampaignEndState
      mode="complete"
      characterName={characterName}
      portraitUrl={portraitUrl}
      identity={identity}
      experience={displayExperience}
      campaignName={campaignName}
      summary={summary}
      chooseHeroHref={chooseHeroHref}
      chooseHeroPending={chooseHeroPending}
      storyContent={storyContent}
    />
  );
};
