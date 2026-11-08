import React, { useLayoutEffect, useState, useCallback, useSyncExternalStore, memo } from 'react';
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
import { TacticalMapProvider, useMapInRail } from '../../tactical/TacticalMapProvider';
import { FloatingActionPanel } from '../FloatingActionPanel';
import { resolveCampaignChapterLabel } from '../overhaul/campaign-chapter';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { Z_INDEX } from '@/constants/z-index';
import { useSceneBackground } from '@/contexts/SceneBackgroundContext';
import { useMediaQuery } from '@/hooks/use-media-query';

const subscribeTableLook = (notify: () => void): (() => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};
const tableLookSnapshot = (): boolean => document.body.classList.contains('ir-table-look');

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
    const tableLook = useSyncExternalStore(subscribeTableLook, tableLookSnapshot, () => false);
    const [tableHeaderSlot, setTableHeaderSlot] = useState<HTMLDivElement | null>(null);
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
    const handleRailOverStoryClose = useCallback((): void => {
      if (tableLook) setTableDrawerOpen(false);
      else if (isLeftCollapsed) setIsRightCollapsed(true);
      else setIsLeftCollapsed(true);
    }, [tableLook, isLeftCollapsed, setIsLeftCollapsed, setIsRightCollapsed]);
    const plainMapInRail = useMapInRail(isLeftCollapsed, isRightCollapsed);
    const tableDesktop = useMediaQuery('(min-width: 1024px)');
    const mapInRail = tableLook ? !tableLeftHidden && tableDesktop : plainMapInRail;
    // #2517: when the character falls, the end state is the whole page — the
    // panels, tracker and floating controls are not rendered at all.
    const [isFallen, setIsFallen] = useState(false);
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
        isCollapsed={tableLook ? tableLeftHidden : isLeftCollapsed}
        tableLook={tableLook}
        onToggle={handleLeftClose}
        onOpenSheet={() => (tableLook ? openTablePanel('character') : setIsRightCollapsed(false))}
        showMap={mapInRail}
        chapterLabel={resolveCampaignChapterLabel(sessionData?.turn_count)}
      />
    );
    const rightPanel = (
      <GameRightPanel
        sessionId={sessionId}
        isCollapsed={tableLook ? !tableDrawerOpen : isRightCollapsed}
        initialTab={tableLook ? tableDrawerTab : undefined}
        initialTabRequest={tableLook ? tableDrawerRequest : undefined}
        sessionData={sessionData}
        updateGameSessionState={updateGameSessionState}
        combatMode={combatMode}
        spellCastHandlerRef={spellCastHandlerRef}
        onToggle={tableLook ? () => setTableDrawerOpen((open) => !open) : handleRightToggle}
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
          {(tableLook || !isCombatDetected) && !isFallen && (
            <div className="flex justify-end px-2 py-1">
              <EndSessionButton
                sessionId={sessionId}
                campaignId={campaignIdForHandler}
                starterCampaignId={sessionData.starter_campaign_id ?? null}
              />
            </div>
          )}
          {tableLook && !isFallen && (
            <div
              ref={setTableHeaderSlot}
              data-testid="table-header-slot"
              className="relative shrink-0"
            />
          )}
          <TacticalMapProvider
            key={sessionId}
            sessionId={sessionId}
            setLeftCollapsed={tableLook ? setTableLeftHidden : setIsLeftCollapsed}
          >
            <div
              key={sessionId}
              className={`grid transition-all duration-300 ease-in-out flex-1 min-h-0 gap-2 md:gap-3 items-stretch w-full ${tableLook ? 'relative' : ''} ${
                tableLook && !isFallen
                  ? tableLeftHidden
                    ? 'grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_280px]'
                    : 'grid-cols-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-rows-1 lg:grid-cols-[260px_minmax(0,1fr)_280px]'
                  : isFallen || overStory || (isLeftCollapsed && isRightCollapsed)
                    ? 'grid-cols-1'
                    : isLeftCollapsed
                      ? 'grid-cols-1 md:grid-cols-[1fr_minmax(300px,340px)]'
                      : isRightCollapsed
                        ? 'grid-cols-1 md:grid-cols-[minmax(210px,250px)_1fr]'
                        : 'grid-cols-1 lg:grid-cols-[minmax(210px,250px)_1fr_minmax(300px,340px)]'
              }`}
            >
              {/* Left Campaign Panel */}
              {(!overStory || tableLook) && !isFallen && leftPanel}

              {/* Main Content Area */}
              <GameMainContent
                sessionId={sessionId}
                tableLook={tableLook}
                tableHeaderSlot={tableHeaderSlot}
                tableRollSlot={tableRollSlot}
                onOpenTablePanel={openTablePanel}
                campaignIdForHandler={campaignIdForHandler}
                characterIdForHandler={characterIdForHandler}
                sessionData={sessionData}
                updateGameSessionState={updateGameSessionState}
                showSceneBlurb={showSceneBlurb}
                onSceneBlurbToggle={onSceneBlurbToggle}
                isLeftCollapsed={tableLook ? tableLeftHidden : isLeftCollapsed}
                isRightCollapsed={tableLook ? !tableDrawerOpen : isRightCollapsed}
                mapInRail={mapInRail}
                onLeftToggle={
                  tableLook ? () => setTableLeftHidden((hidden) => !hidden) : handleLeftToggle
                }
                onRightToggle={
                  tableLook ? () => setTableDrawerOpen((open) => !open) : handleRightToggle
                }
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

              {tableLook && !isFallen && (
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
              {/* Right Character/Memory Panel. Closed, it is only a fixed floating toggle, so its
                  wrapper is `contents`: an empty grid item made a second row that took half the
                  height and lifted the chat box off the bottom of a narrow screen (#2281). */}
              {!tableLook && !isFallen && (!overStory || isRightCollapsed) && (
                <div
                  className={
                    isRightCollapsed ? 'contents' : isLeftCollapsed ? 'order-2' : 'order-3'
                  }
                >
                  {rightPanel}
                </div>
              )}

              {/* Floating Action Panel for Quick RPG Actions */}
              {!tableLook &&
                !isFallen &&
                (portalToStory
                  ? createPortal(floatingPanel(true), portalToStory)
                  : floatingPanel(false))}

              {/* A rail opened on a narrow screen: over the story, above the dock. */}
              {!isFallen &&
                portalToStory &&
                (tableLook
                  ? overStory && tableDrawerOpen
                  : !isLeftCollapsed || !isRightCollapsed) &&
                createPortal(
                  <RailOverStoryLayer
                    key={tableLook || isLeftCollapsed ? 'right' : 'left'}
                    onClose={handleRailOverStoryClose}
                    sizeByCast={tableLook || isLeftCollapsed}
                  >
                    {tableLook || isLeftCollapsed ? rightPanel : leftPanel}
                  </RailOverStoryLayer>,
                  portalToStory,
                )}

              {tableLook && !overStory && tableDrawerOpen && !isFallen && (
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
          {tableLook && !isFallen && (
            <div className="shrink-0 text-right">
              <BuildSessionStatus sessionId={sessionId} />
            </div>
          )}
        </div>
      </div>
    );
  },
);

GameLayout.displayName = 'GameLayout';
