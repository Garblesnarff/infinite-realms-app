import React, { useLayoutEffect, useState, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

import { BuildSessionStatus } from './BuildSessionStatus';
import { EndSessionButton } from './EndSessionButton';
import { GameCombatSheet } from './GameCombatSheet';
import { GameLeftPanel } from './GameLeftPanel';
import { GameMainContent } from './GameMainContent';
import { GameRightPanel } from './GameRightPanel';
import { RailOverStoryLayer } from './RailOverStoryLayer';
import { TableContextCard } from './TableContextCard';
import { RAIL_OVER_STORY } from './use-game-rails';
import { TacticalMapProvider } from '../../tactical/TacticalMapProvider';
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
  /** #865: the greeting generation passed its stall deadline; the overlay offers a retry. */
  greetingTimedOut?: boolean;
  /** #865: re-request the opening scene from the stalled overlay. */
  onRetryGreeting?: () => void;
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
    showSceneBlurb,
    onSceneBlurbToggle,
    combatMode,
    showTracker,
    setShowTracker,
    isCombatDetected,
    isGeneratingGreeting,
    greetingTimedOut = false,
    onRetryGreeting,
    innerHandleAIResponse,
    isDM,
    spellCastHandlerRef,
    lastSafetyCommand,
    contentWarnings,
    comfortLevel,
    showSafetyInfo,
  }) => {
    const [tableHeaderSlot, setTableHeaderSlot] = useState<HTMLDivElement | null>(null);
    const [tableControlsSlot, setTableControlsSlot] = useState<HTMLDivElement | null>(null);
    const [tableRollSlot, setTableRollSlot] = useState<HTMLDivElement | null>(null);
    const [tableDrawerOpen, setTableDrawerOpen] = useState(false);
    const [tableDrawerRequest, setTableDrawerRequest] = useState(0);
    const [tableLeftHidden, setTableLeftHidden] = useState(false);
    const [tableDrawerTab, setTableDrawerTab] = useState<'character' | 'memory' | 'journal'>(
      'character',
    );
    const openTablePanel = useCallback((tab: 'character' | 'memory' | 'journal'): void => {
      setTableDrawerTab(tab);
      setTableDrawerRequest((request) => request + 1);
      setTableDrawerOpen(true);
    }, []);
    const [topOffset, setTopOffset] = useState(0);
    const { currentBackgroundUrl, isTransitioning } = useSceneBackground();

    const handleRailOverStoryClose = useCallback((): void => {
      setTableDrawerOpen(false);
    }, []);
    const tableDesktop = useMediaQuery('(min-width: 1024px)');
    const mapInRail = !tableLeftHidden && tableDesktop;
    // #2517: when the character falls, the end state is the whole page — the
    // panels, tracker and floating controls are not rendered at all.
    const [isFallen, setIsFallen] = useState(false);
    // Below md an open rail has no column. It opens over the story box instead, which ends
    // where the dock (roll tray + chat box) begins, so no panel can cover the composer (#2281).
    // The floating buttons move into the story box too, off the chat box.
    const overStory = useMediaQuery(RAIL_OVER_STORY);
    const [storyBox, setStoryBox] = useState<HTMLDivElement | null>(null);
    const portalToStory = overStory ? storyBox : null;

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
        isCollapsed={tableLeftHidden}
        onToggle={() => setTableLeftHidden(true)}
        onOpenSheet={() => openTablePanel('character')}
        chapterLabel={resolveCampaignChapterLabel(sessionData?.turn_count)}
      />
    );
    const rightPanel = (
      <GameRightPanel
        sessionId={sessionId}
        isCollapsed={!tableDrawerOpen}
        initialTab={tableDrawerTab}
        initialTabRequest={tableDrawerRequest}
        sessionData={sessionData}
        updateGameSessionState={updateGameSessionState}
        combatMode={combatMode}
        spellCastHandlerRef={spellCastHandlerRef}
        onToggle={() => setTableDrawerOpen((open) => !open)}
      />
    );

    return (
      <div
        className="ir-table-walnut relative max-w-full overflow-x-hidden bg-background"
        style={{ ['--top-offset' as string]: `${topOffset}px` }}
      >
        <div className="ir-table-felt pointer-events-none absolute inset-2" aria-hidden="true" />
        <div className="ir-candle pointer-events-none absolute left-4 top-8" aria-hidden="true" />
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
          className="w-full h-[calc(100dvh-var(--top-offset,0px))] mobile-bottom-safe overflow-hidden relative flex flex-col"
          style={{ zIndex: Z_INDEX.DROPDOWN }}
        >
          {!isFallen && (
            <div className="flex items-center justify-end gap-1 px-2 py-0">
              <div
                ref={setTableControlsSlot}
                data-testid="table-controls-slot"
                className="flex items-center gap-1"
              />
              <EndSessionButton
                sessionId={sessionId}
                campaignId={campaignIdForHandler}
                starterCampaignId={sessionData.starter_campaign_id ?? null}
              />
            </div>
          )}
          {!isFallen && (
            <div
              ref={setTableHeaderSlot}
              data-testid="table-header-slot"
              className="relative shrink-0"
            />
          )}
          <TacticalMapProvider
            key={sessionId}
            sessionId={sessionId}
            setLeftCollapsed={setTableLeftHidden}
          >
            <div
              key={sessionId}
              className={`grid relative transition-all duration-300 ease-in-out flex-1 min-h-0 gap-2 md:gap-3 items-stretch w-full ${
                isFallen
                  ? 'grid-cols-1'
                  : tableLeftHidden
                    ? 'grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_280px]'
                    : 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[260px_minmax(0,1fr)_280px]'
              }`}
            >
              {/* Left Campaign Panel */}
              {!isFallen && leftPanel}

              {/* Main Content Area */}
              <GameMainContent
                sessionId={sessionId}
                tableHeaderSlot={tableHeaderSlot}
                tableControlsSlot={tableControlsSlot}
                tableRollSlot={tableRollSlot}
                onOpenTablePanel={openTablePanel}
                campaignIdForHandler={campaignIdForHandler}
                characterIdForHandler={characterIdForHandler}
                sessionData={sessionData}
                updateGameSessionState={updateGameSessionState}
                showSceneBlurb={showSceneBlurb}
                onSceneBlurbToggle={onSceneBlurbToggle}
                isLeftCollapsed={tableLeftHidden}
                isRightCollapsed={!tableDrawerOpen}
                mapInRail={mapInRail}
                onLeftToggle={() => setTableLeftHidden((hidden) => !hidden)}
                onRightToggle={() => setTableDrawerOpen((open) => !open)}
                storyBoxRef={setStoryBox}
                showTracker={showTracker}
                setShowTracker={setShowTracker}
                isCombatDetected={isCombatDetected}
                isGeneratingGreeting={isGeneratingGreeting}
                greetingTimedOut={greetingTimedOut}
                onRetryGreeting={onRetryGreeting}
                innerHandleAIResponse={innerHandleAIResponse}
                spellCastHandlerRef={spellCastHandlerRef}
                lastSafetyCommand={lastSafetyCommand}
                contentWarnings={contentWarnings}
                comfortLevel={comfortLevel}
                showSafetyInfo={showSafetyInfo}
                onFallenChange={setIsFallen}
              />

              {!isFallen && (
                <aside
                  data-testid="table-roll-column"
                  className="contents lg:order-3 lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:overflow-y-auto"
                >
                  <div className="hidden rounded-xl border-2 border-[#a9823f] bg-[#4b1116] p-3 text-[#f6e3b8] lg:block">
                    <h2 className="font-heading text-lg font-bold">Roll at the table</h2>
                    <p className="ir-table-roll-wait text-sm">
                      The rules engine waits for your roll.
                    </p>
                  </div>
                  <div
                    ref={setTableRollSlot}
                    data-testid="table-roll-slot"
                    className="ir-table-roll-host fixed inset-x-0 bottom-0 z-50 max-h-[70dvh] overflow-y-auto empty:hidden lg:static lg:max-h-none lg:overflow-visible"
                  />
                  <div className="hidden lg:block">
                    <TableContextCard sessionId={sessionId} />
                  </div>
                </aside>
              )}
              {/* A drawer opened on a narrow screen: over the story, above the dock. */}
              {!isFallen &&
                portalToStory &&
                overStory &&
                tableDrawerOpen &&
                createPortal(
                  <RailOverStoryLayer key="right" onClose={handleRailOverStoryClose} sizeByCast>
                    {rightPanel}
                  </RailOverStoryLayer>,
                  portalToStory,
                )}

              {!overStory && tableDrawerOpen && !isFallen && (
                <div className="absolute inset-y-0 right-0 z-50 w-[min(90vw,380px)] overflow-hidden bg-[#0b1120] shadow-2xl">
                  {rightPanel}
                </div>
              )}
              {/* Combat Tracker Sheet */}
              {!isFallen && (
                <GameCombatSheet
                  showTracker={showTracker}
                  setShowTracker={setShowTracker}
                  isDM={isDM}
                  spellCastHandlerRef={spellCastHandlerRef}
                  sessionId={sessionId}
                />
              )}
            </div>
          </TacticalMapProvider>
          {!isFallen && (
            // Out of flow: the build line takes no height and keeps its 10 px text. The copy button
            // gets a 44x44 hit box on every pointer (#1421 target rule): a transparent ::before
            // anchored to its bottom-right corner, so the box stays inside the table.
            <div
              data-testid="table-build-line"
              className="pointer-events-none absolute bottom-0 right-1 z-10 text-[10px] leading-none [&>button]:pointer-events-auto [&>button]:relative [&>button]:!text-[10px] [&>button]:!min-h-0 [&>button]:!min-w-0 [&>button]:before:absolute [&>button]:before:bottom-0 [&>button]:before:right-0 [&>button]:before:h-11 [&>button]:before:w-11 [&>button]:before:content-['']"
            >
              <BuildSessionStatus sessionId={sessionId} />
            </div>
          )}
        </div>
      </div>
    );
  },
);

GameLayout.displayName = 'GameLayout';
