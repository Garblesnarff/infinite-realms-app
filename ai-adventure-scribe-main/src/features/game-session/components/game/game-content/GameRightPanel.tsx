import { ChevronDown } from 'lucide-react';
import React, { memo } from 'react';

import { GameSidePanel } from '../MemoryPanel';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { Button } from '@/components/ui/button';
import { Z_INDEX } from '@/constants/z-index';

/**
 * GameRightPanel Component
 *
 * Wrapper for the right sidebar containing character sheet, inventory, and game panels.
 * Includes floating toggle button when panel is collapsed.
 */

interface GameRightPanelProps {
  sessionId?: string;
  isCollapsed: boolean;
  sessionData: ExtendedGameSession;
  updateGameSessionState: (newState: SessionStateUpdater) => Promise<void>;
  combatMode: boolean;
  spellCastHandlerRef: SpellCastHandlerRef;
  onToggle: () => void;
}

export const GameRightPanel: React.FC<GameRightPanelProps> = memo(
  ({
    sessionId,
    isCollapsed,
    sessionData,
    updateGameSessionState,
    combatMode,
    spellCastHandlerRef,
    onToggle,
  }) => {
    if (!isCollapsed) {
      return (
        <div className="w-full md:w-auto min-h-0 transition-all duration-300">
          <GameSidePanel
            sessionId={sessionId}
            sessionData={sessionData}
            updateGameSessionState={updateGameSessionState}
            combatMode={combatMode}
            spellCastHandlerRef={spellCastHandlerRef}
            isCollapsed={isCollapsed}
            onToggle={onToggle}
          />
        </div>
      );
    }

    // Floating toggle button when collapsed. Below md it would sit on the chat box's send
    // button, and the header's "Show Character" already opens the sheet there (#2281).
    return (
      <div
        className="fixed hidden md:block md:top-1/2 md:right-6 md:-translate-y-1/2 transition-all duration-300"
        style={{ zIndex: Z_INDEX.FLOATING_PANEL }}
      >
        <Button
          variant="outline"
          size="sm"
          onClick={onToggle}
          aria-label="Toggle game panel"
          title="Toggle game panel"
          className={`rounded-full p-4 h-auto shadow-2xl border-2 hover:scale-110 transition-all duration-300 hover-glow focus-glow touch-manipulation min-h-[48px] min-w-[48px] ${
            combatMode
              ? 'bg-gradient-to-r from-red-500/20 to-red-600/20 border-red-400/50 animate-pulse'
              : 'bg-gradient-to-r from-infinite-purple/20 to-infinite-teal/20 border-infinite-purple/50'
          }`}
        >
          <ChevronDown className="h-5 w-5 rotate-90" />
          {/* Enhanced Context indicators */}
          <div className="absolute -top-2 -right-2 flex flex-col gap-1">
            {combatMode && (
              <div className="w-3 h-3 bg-red-400 rounded-full animate-pulse shadow-lg"></div>
            )}
            <div className="w-3 h-3 bg-infinite-gold rounded-full animate-pulse shadow-lg"></div>
          </div>
        </Button>
      </div>
    );
  },
);

GameRightPanel.displayName = 'GameRightPanel';
