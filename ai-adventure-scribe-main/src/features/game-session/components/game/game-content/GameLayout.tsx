import React, { useLayoutEffect, useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

import { GameCombatSheet } from './GameCombatSheet';
import { GameLeftPanel } from './GameLeftPanel';
import { GameMainContent } from './GameMainContent';
import { GameRightPanel } from './GameRightPanel';
import { RAIL_OVER_STORY } from './use-game-rails';
import { TacticalMapProvider, useMapInRail } from '../../tactical/TacticalMapProvider';
import { FloatingActionPanel } from '../FloatingActionPanel';
import { resolveCampaignChapterLabel } from '../overhaul/campaign-chapter';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { Z_INDEX } from '@/constants/z-index';
import { useSceneBackground } from '@/contexts/SceneBackgroundContext';
import { useMediaQuery } from '@/hooks/use-media-query';

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
  spellCastHandlerRef: SpellCastHandlerRef;
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
export const GameLayout: React.FC<GameLayoutProps> = memo(
  ({
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
    spellCastHandlerRef,
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
    const mapInRail = useMapInRail(isLeftCollapsed, isRightCollapsed);
    // Below md an open rail has no column. It opens over the story box instead, which ends
    // where the dock (roll tray + chat box) begins, so no panel can cover the composer (#2281).
    // The floating buttons move into the story box too, off the chat box.
    const overStory = useMediaQuery(RAIL_OVER_STORY);
    const [storyBox, setStoryBox] = useState<HTMLDivElement | null>(null);
    const portalToStory = overStory ? storyBox : null;

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

    const leftPanel = (
      <GameLeftPanel
        sessionId={sessionId}
        isCollapsed={isLeftCollapsed}
        onToggle={handleLeftClose}
        showMap={mapInRail}
        chapterLabel={resolveCampaignChapterLabel(sessionData?.turn_count)}
      />
    );
    const rightPanel = (
      <GameRightPanel
        sessionId={sessionId}
        isCollapsed={isRightCollapsed}
        sessionData={sessionData}
        updateGameSessionState={updateGameSessionState}
        combatMode={combatMode}
        spellCastHandlerRef={spellCastHandlerRef}
        onToggle={handleRightToggle}
      />
    );
    const floatingPanel = (anchored: boolean): React.ReactNode => (
      <FloatingActionPanel
        isVisible={isFloatingPanelVisible}
        onToggle={handleFloatingPanelToggle}
        combatMode={combatMode}
        anchored={anchored}
      />
    );

    return (
      <div
        className="relative max-w-full overflow-x-hidden bg-background"
        style={{ ['--top-offset' as string]: `${topOffset}px` }}
      >
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
          <TacticalMapProvider
            key={sessionId}
            sessionId={sessionId}
            setLeftCollapsed={setIsLeftCollapsed}
          >
            <div
              key={sessionId}
              className={`grid transition-all duration-300 ease-in-out h-full gap-2 md:gap-3 items-stretch w-full ${
                overStory || (isLeftCollapsed && isRightCollapsed)
                  ? 'grid-cols-1'
                  : isLeftCollapsed
                    ? 'grid-cols-1 md:grid-cols-[1fr_minmax(300px,340px)]'
                    : isRightCollapsed
                      ? 'grid-cols-1 md:grid-cols-[minmax(210px,250px)_1fr]'
                      : 'grid-cols-1 lg:grid-cols-[minmax(210px,250px)_1fr_minmax(300px,340px)]'
              }`}
            >
              {/* Left Campaign Panel */}
              {!overStory && leftPanel}

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
                mapInRail={mapInRail}
                onLeftToggle={handleLeftToggle}
                onRightToggle={handleRightToggle}
                storyBoxRef={setStoryBox}
                showTracker={showTracker}
                setShowTracker={setShowTracker}
                isCombatDetected={isCombatDetected}
                isGeneratingGreeting={isGeneratingGreeting}
                innerHandleAIResponse={innerHandleAIResponse}
                spellCastHandlerRef={spellCastHandlerRef}
                lastSafetyCommand={lastSafetyCommand}
                contentWarnings={contentWarnings}
                comfortLevel={comfortLevel}
                showSafetyInfo={showSafetyInfo}
              />

              {/* Right Character/Memory Panel. Closed, it is only a fixed floating toggle, so its
                  wrapper is `contents`: an empty grid item made a second row that took half the
                  height and lifted the chat box off the bottom of a narrow screen (#2281). */}
              {(!overStory || isRightCollapsed) && (
                <div
                  className={
                    isRightCollapsed ? 'contents' : isLeftCollapsed ? 'order-2' : 'order-3'
                  }
                >
                  {rightPanel}
                </div>
              )}

              {/* Floating Action Panel for Quick RPG Actions */}
              {portalToStory
                ? createPortal(floatingPanel(true), portalToStory)
                : floatingPanel(false)}

              {/* A rail opened on a narrow screen: over the story, above the dock. */}
              {portalToStory &&
                (!isLeftCollapsed || !isRightCollapsed) &&
                createPortal(
                  <div
                    data-testid="rail-over-story"
                    className="absolute inset-0 overflow-y-auto bg-infinite-dark/95 backdrop-blur-sm"
                    style={{ zIndex: Z_INDEX.CARD_HOVER }}
                  >
                    {isLeftCollapsed ? rightPanel : leftPanel}
                  </div>,
                  portalToStory,
                )}

              {/* Combat Tracker Sheet */}
              <GameCombatSheet
                showTracker={showTracker}
                setShowTracker={setShowTracker}
                isDM={isDM}
              />
            </div>
          </TacticalMapProvider>
        </div>
      </div>
    );
  },
);

GameLayout.displayName = 'GameLayout';
