import React from 'react';

import { RightSheet } from './RightSheet';
import { useOverhaulViewModel } from './useOverhaulViewModel';

/**
 * Live-wired character sheet rail, reading from the character / combat contexts.
 * Used as the "Character" view of the right game panel.
 */
export const RightSheetLive: React.FC<{ sessionId?: string }> = React.memo(({ sessionId }) => {
  const vm = useOverhaulViewModel();
  return <RightSheet c={vm.character} sessionId={sessionId} />;
});

RightSheetLive.displayName = 'RightSheetLive';
