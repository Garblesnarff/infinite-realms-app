import React, { useLayoutEffect, useState, useCallback, memo } from 'react';


import { GameCombatSheet } from './GameCombatSheet';
import { GameLeftPanel } from './GameLeftPanel';
import { GameMainContent } from './GameMainContent';
import { GameRightPanel } from './GameRightPanel';
import { FloatingActionPanel } from '../FloatingActionPanel';

import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { Z_INDEX } from '@/constants/z-index';
import { useSceneBackground } from '@/contexts/SceneBackgroundContext';

/**
 * GameLayout Component
 *
 * Main layout orchestrator for the game interface.
 * Manages the three-column grid layout with responsive collapsing panels.
 * Handles top offset calculation for sticky navigation.
 */

interface GameLayoutProps {
  sessionId: string;
  campaignIdForHandler: string | null;
  characterIdForHandler: string | null;
  sessionData: ExtendedGameSession;
  updateGameSessionState: (newState: SessionStateUpdater) => Promise<void>;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  setIsLeftCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  setIsRightCollapsed: (v: boolean | ((prev: boolean) => boolean)) => void;
  showSceneBlurb: boolean;
  onSceneBlurbToggle: () => void;
  combatMode: boolean;
  showTracker: boolean;
  setShowTracker: (v: boolean) => void;
  isCombatDetected: boolean;
  isGeneratingGreeting: boolean;
  innerHandleAIResponse: (message: unknown) => Promise<void>;
  isDM: boolean;
  lastSafetyCommand?: {
    type: 'x_card' | 'veil' | 'pause' | 'resume';
    timestamp: string;
    autoTriggered?: boolean;
  };
  contentWarnings: string[];
  comfortLevel: 'pg' | 'pg13' | 'r' | 'custom';
  showSafetyInfo: boolean;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the entire layout.
 * Optimized with useCallback for stable handlers to ensure memoized children
 * (LeftPanel, RightPanel, etc.) don't re-render unless their specific props change.
 */
export const GameLayout: React.FC<GameLayoutProps> = memo(({
  sessionId,
  campaignIdForHandler,
  characterIdForHandler,
  sessionData,
  updateGameSessionState,
  isLeftCollapsed,
  isRightCollapsed,
  setIsLeftCollapsed,
  setIsRightCollapsed,
  showSceneBlurb,
  onSceneBlurbToggle,
  combatMode,
  showTracker,
  setShowTracker,
  isCombatDetected,
  isGeneratingGreeting,
  innerHandleAIResponse,
  isDM,
  lastSafetyCommand,
  contentWarnings,
  comfortLevel,
  showSafetyInfo,
}) => {
  const [topOffset, setTopOffset] = useState(0);
  const [isFloatingPanelVisible, setIsFloatingPanelVisible] = useState(false);
  const { currentBackgroundUrl, isTransitioning } = useSceneBackground();

  // ⚡ Bolt: Stable callbacks for UI toggles to prevent child re-renders
  const handleLeftToggle = useCallback((): void => {
    setIsLeftCollapsed((v) => !v);
  }, [setIsLeftCollapsed]);

  const handleRightToggle = useCallback((): void => {
    setIsRightCollapsed((v) => !v);
  }, [setIsRightCollapsed]);

  const handleLeftClose = useCallback((): void => {
    setIsLeftCollapsed(true);
  }, [setIsLeftCollapsed]);

  const handleFloatingPanelToggle = useCallback((): void => {
    setIsFloatingPanelVisible((v) => !v);
  }, []);

  // Measure sticky nav + breadcrumbs height to constrain viewport
  useLayoutEffect(() => {
    const calc = (): void => {
      const nav = document.getElementById('app-nav')?.offsetHeight || 0;
      const crumbs = document.getElementById('app-breadcrumbs')?.offsetHeight || 0;
      setTopOffset(nav + crumbs);
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  return (
    <div className="bg-background relative" style={{ ['--top-offset' as string]: `${topOffset}px` }}>
      {/* Scene background layer */}
      {currentBackgroundUrl && (
        <div
          className="fixed inset-0 pointer-events-none transition-opacity duration-1000"
          style={{
            backgroundImage: `url(${currentBackgroundUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: isTransitioning ? 0 : 0.15,
            zIndex: Z_INDEX.BASE,
          }}
        >
          {/* Dark overlay for better readability */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/60" />
        </div>
      )}

      <div
        className="w-full h-[calc(100dvh-var(--top-offset,0px))] mobile-bottom-safe overflow-hidden relative"
        style={{ zIndex: Z_INDEX.DROPDOWN }}
      >
        <div
          key={sessionId}
          className={`grid transition-all duration-300 ease-in-out h-full gap-2 md:gap-3 items-stretch w-full ${
            isLeftCollapsed && isRightCollapsed
              ? 'grid-cols-1'
              : isLeftCollapsed
                ? 'grid-cols-1 md:grid-cols-[1fr_minmax(300px,340px)]'
                : isRightCollapsed
                  ? 'grid-cols-1 md:grid-cols-[minmax(210px,250px)_1fr]'
                  : 'grid-cols-1 lg:grid-cols-[minmax(210px,250px)_1fr_minmax(300px,340px)]'
          }`}
        >
          {/* Left Campaign Panel */}
          <GameLeftPanel
            isCollapsed={isLeftCollapsed}
            onToggle={handleLeftClose}
            chapterLabel={`Chapter ${sessionData?.turn_count ?? 0}`}
          />

          {/* Main Content Area */}
          <GameMainContent
            sessionId={sessionId}
            campaignIdForHandler={campaignIdForHandler}
            characterIdForHandler={characterIdForHandler}
            sessionData={sessionData}
            updateGameSessionState={updateGameSessionState}
            showSceneBlurb={showSceneBlurb}
            onSceneBlurbToggle={onSceneBlurbToggle}
            isLeftCollapsed={isLeftCollapsed}
            isRightCollapsed={isRightCollapsed}
            onLeftToggle={handleLeftToggle}
            onRightToggle={handleRightToggle}
            showTracker={showTracker}
            setShowTracker={setShowTracker}
            isCombatDetected={isCombatDetected}
            isGeneratingGreeting={isGeneratingGreeting}
            innerHandleAIResponse={innerHandleAIResponse}
            lastSafetyCommand={lastSafetyCommand}
            contentWarnings={contentWarnings}
            comfortLevel={comfortLevel}
            showSafetyInfo={showSafetyInfo}
          />

          {/* Right Character/Memory Panel */}
          <div className={`${isLeftCollapsed ? 'order-2' : 'order-3'}`}>
            <GameRightPanel
              isCollapsed={isRightCollapsed}
              sessionData={sessionData}
              updateGameSessionState={updateGameSessionState}
              combatMode={combatMode}
              onToggle={handleRightToggle}
            />
          </div>

          {/* Floating Action Panel for Quick RPG Actions */}
          <FloatingActionPanel
            isVisible={isFloatingPanelVisible}
            onToggle={handleFloatingPanelToggle}
            combatMode={combatMode}
          />

          {/* Combat Tracker Sheet */}
          <GameCombatSheet showTracker={showTracker} setShowTracker={setShowTracker} isDM={isDM} />
        </div>
      </div>
    </div>
  );
});

GameLayout.displayName = 'GameLayout';
