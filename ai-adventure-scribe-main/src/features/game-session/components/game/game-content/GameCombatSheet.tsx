import React, { memo, useMemo } from 'react';

import { useShowTargetNumbers } from '../../../hooks/use-show-target-numbers';

import type { SpellCastHandlerRef } from '../spell-cast-handler';

import CombatInterface from '@/components/combat/CombatInterface';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useMessageContext } from '@/contexts/MessageContext';
import { combatLogLines } from '@/utils/combat-log-lines';

/**
 * GameCombatSheet Component
 *
 * Displays the combat tracker interface in a side sheet.
 * Only shown when combat is active and user opens the tracker.
 *
 * The tracker is read-only for players (#2257). `isDM` here means "campaign owner", and in a solo
 * campaign that is every player, so it does not unlock game-master controls by itself: they
 * need a dev build as well. `import.meta.env.DEV` is a build-time constant, so a production
 * bundle never shows them.
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the combat
 * tracker sheet when parent game layout updates.
 */

interface GameCombatSheetProps {
  showTracker: boolean;
  setShowTracker: (show: boolean) => void;
  isDM: boolean;
  spellCastHandlerRef?: SpellCastHandlerRef;
}

export const GameCombatSheet: React.FC<GameCombatSheetProps> = memo(
  ({ showTracker, setShowTracker, isDM, spellCastHandlerRef }) => {
    const { messages = [] } = useMessageContext();
    const { showTargetNumbers } = useShowTargetNumbers();
    // Only read the chat while the sheet is open; the log is the engine lines the chat shows.
    const logLines = useMemo(
      () => (showTracker ? combatLogLines(messages, undefined, showTargetNumbers) : []),
      [showTracker, messages, showTargetNumbers],
    );

    return (
      <Sheet open={showTracker} onOpenChange={setShowTracker}>
        <SheetContent side="right" className="w-full sm:w-[420px] sm:max-w-[480px] overflow-y-auto">
          <CombatInterface
            isDM={isDM && import.meta.env.DEV}
            logLines={logLines}
            spellCastHandlerRef={spellCastHandlerRef}
            onSpellCastStart={() => setShowTracker(false)}
          />
        </SheetContent>
      </Sheet>
    );
  },
);

GameCombatSheet.displayName = 'GameCombatSheet';
