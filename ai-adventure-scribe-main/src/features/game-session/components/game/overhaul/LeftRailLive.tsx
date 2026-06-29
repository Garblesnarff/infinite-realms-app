import React from 'react';

import { LeftRail } from './LeftRail';
import { useOverhaulViewModel } from './useOverhaulViewModel';

/**
 * Live-wired left rail (Current Campaign / Objective / Region Map / Party /
 * Encounter Tracker), reading from the campaign / character / combat contexts.
 */
export const LeftRailLive: React.FC<{ chapterLabel?: string }> = React.memo(({ chapterLabel }) => {
  const vm = useOverhaulViewModel({ chapterLabel });
  return <LeftRail campaign={vm.campaign} party={vm.party} partyMax={vm.partyMax} combat={vm.combat} />;
});

LeftRailLive.displayName = 'LeftRailLive';
