import React from 'react';

import { LeftRail } from './LeftRail';
import { useOverhaulViewModel } from './useOverhaulViewModel';

import { useMessageContext } from '@/contexts/MessageContext';

/**
 * Live-wired left rail (Current Campaign / Objective / Region Map / Party /
 * Encounter Tracker), reading from the campaign / character / combat contexts.
 */
export const LeftRailLive: React.FC<{ sessionId: string; chapterLabel?: string }> = React.memo(
  ({ sessionId, chapterLabel }) => {
    const { messages } = useMessageContext();
    const vm = useOverhaulViewModel({ sessionId, messages, chapterLabel });
    return (
      <LeftRail campaign={vm.campaign} party={vm.party} partyMax={vm.partyMax} combat={vm.combat} />
    );
  },
);

LeftRailLive.displayName = 'LeftRailLive';
