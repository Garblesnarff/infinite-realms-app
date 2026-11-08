import React from 'react';

import { LeftRail, TableCharacterCard } from './LeftRail';
import { useOverhaulViewModel } from './useOverhaulViewModel';

import { useOptionalCharacter } from '@/contexts/CharacterContext';
import { useMessageContext } from '@/contexts/MessageContext';

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
  const characterImage = useOptionalCharacter()?.state.character?.image_url;
  return (
    <>
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
          preferredPortrait={characterImage}
          onOpenSheet={onOpenSheet}
        />
      </div>
    </>
  );
});

LeftRailLive.displayName = 'LeftRailLive';
