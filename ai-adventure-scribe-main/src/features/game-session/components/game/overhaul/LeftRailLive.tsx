import React from 'react';

import { LeftRail, TableCharacterCard } from './LeftRail';
import { useOverhaulViewModel } from './useOverhaulViewModel';
import { useOpenStoryMapCampaign } from '../../story-map/story-map-state';
import { StoryMapPanel } from '../../story-map/StoryMapPanel';

import { useOptionalCharacter } from '@/contexts/CharacterContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { useMediaQuery } from '@/hooks/use-media-query';

/**
 * Live-wired left rail (Current Campaign / Objective / Region Map / Party /
 * Encounter Tracker), reading from the campaign / character / combat contexts.
 */
export const LeftRailLive: React.FC<{
  sessionId: string;
  chapterLabel?: string;
  onOpenSheet: () => void;
}> = React.memo(({ sessionId, chapterLabel, onOpenSheet }) => {
  const { messages } = useMessageContext();
  const vm = useOverhaulViewModel({ sessionId, messages, chapterLabel });
  const character = useOptionalCharacter()?.state.character;
  // #1754: the region map opens here when the rail holds the fight board, the same
  // 1024 px rule as GameLayout's mapInRail; narrower screens use the sheet.
  const storyMapCampaignId = useOpenStoryMapCampaign();
  const railHoldsMap = useMediaQuery('(min-width: 1024px)');
  return (
    <>
      {storyMapCampaignId && railHoldsMap && (
        <div className="mb-3">
          <StoryMapPanel campaignId={storyMapCampaignId} layout="rail" />
        </div>
      )}
      <div className="[body.ir-table-look_&]:hidden h-full">
        <LeftRail
          campaign={vm.campaign}
          party={vm.party}
          partyMax={vm.partyMax}
          combat={vm.combat}
        />
      </div>
      <div className="hidden [body.ir-table-look_&]:block">
        <TableCharacterCard
          character={vm.character}
          characterId={character?.id}
          preferredPortrait={character?.image_url}
          onOpenSheet={onOpenSheet}
        />
      </div>
    </>
  );
});

LeftRailLive.displayName = 'LeftRailLive';
