import { Dice6, Map as MapIcon, Sword, X } from 'lucide-react';
import React, { memo } from 'react';

import { BuildSessionStatus } from './BuildSessionStatus';
import { buildChooseHeroHref, FallenEndState, FallenStoryLog } from './DeathScreen';
import { GamePanelControls } from './GamePanelControls';
import { currentQueueRoll, queueRollLabel } from './queue-roll-label';
import { RollTraySlotProvider } from './roll-tray-slot';
import { TargetNumbersToggle } from './TargetNumbersToggle';
import { ChatInput } from '../../chat/ChatInput';
import { MessageList } from '../../chat/MessageList';
import { TacticalMapBoard } from '../../tactical/TacticalMapBoard';
import { useTacticalMapContext } from '../../tactical/TacticalMapProvider';
import { DyingComposerSlot } from '../dying/DyingComposerSlot';
import { MessageHandler } from '../message/MessageHandler';
import { resolveCampaignChapterLabel } from '../overhaul/campaign-chapter';
import { CombatTurnBarLive } from '../overhaul/CombatTurnBar';
import { SceneHeader } from '../overhaul/SceneHeader';
import { useOverhaulViewModel } from '../overhaul/useOverhaulViewModel';
import { StatsBar } from '../StatsBar';
import { TimelineRail } from '../TimelineRail';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { CombatTurnPreflightStatus } from '@/hooks/ai/combat-turn-preflight';
import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { SafetyBanner } from '@/components/safety/SafetyBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useGame } from '@/contexts/GameContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';
import { stripAssetTags } from '@/lib/utils';
import { useDmWaiting } from '@/services/ai/dm-wait';
import { useSheetCastProgress } from '@/services/combat/sheet-cast-progress';
import { stripEngineGeneratedLines } from '@/utils/engine-lines';

/**
 * #2517: the fallen end state for the live game screen. Kept as a separate
 * component so GameMainContent itself never calls the character/campaign
 * hooks — the providers are only required on the terminal path, not for
 * every render (some test harnesses render GameMainContent without them).
 * The hero pick routes back into THIS campaign: a starter campaign through
 * its choose-character page, a custom campaign through creation carrying
 * the campaign.
 */
function FallenEndStateWithCharacter({
  finalLines,
  sessionData,
  campaignIdForHandler,
}: {
  finalLines?: string[];
  sessionData: ExtendedGameSession;
  campaignIdForHandler: string | null;
}) {
  const { state: characterState } = useCharacter();
  const { state: campaignState } = useCampaign();
  const { campaigns: starterCampaigns, isLoading: starterCampaignsLoading } = useStarterCampaigns();
  const starterSlug = sessionData.starter_campaign_id
    ? (starterCampaigns.find((c) => c.id === sessionData.starter_campaign_id)?.slug ?? null)
    : null;
  return (
    <FallenEndState
      characterName={characterState.character?.name ?? null}
      finalLines={finalLines}
      campaignName={campaignState.campaign?.name ?? null}
      chooseHeroHref={buildChooseHeroHref({
        starterSlug,
        campaignId: sessionData.campaign_id ?? campaignIdForHandler,
      })}
      chooseHeroPending={Boolean(sessionData.starter_campaign_id) && starterCampaignsLoading}
      storyContent={<FallenStoryLog />}
    />
  );
}

/** Pixels from the top of `card` to the top of `dock`, tracked while `active`. */
function useHeightAboveDock(
  active: boolean,
  cardRef: React.RefObject<HTMLElement>,
  dockRef: React.RefObject<HTMLElement>,
): number | null {
  const [height, setHeight] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    const card = cardRef.current;
    const dock = dockRef.current;
    if (!active || !card || !dock) return;
    const measure = (): void =>
      setHeight(Math.max(0, dock.getBoundingClientRect().top - card.getBoundingClientRect().top));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [active, cardRef, dockRef]);
  return height;
}

/**
 * GameMainContent Component
 *
 * Contains the primary game interface including chat, stats, combat status, and scene info.
 * Handles message flow, typing indicators, and pending roll notifications.
 */

interface GameMainContentProps {
  sessionId: string;
  campaignIdForHandler: string | null;
  characterIdForHandler: string | null;
  sessionData: ExtendedGameSession;
  updateGameSessionState: (newState: SessionStateUpdater) => Promise<void> | void;
  showSceneBlurb: boolean;
  onSceneBlurbToggle: () => void;
  isLeftCollapsed: boolean;
  isRightCollapsed: boolean;
  /** The left rail is showing the tactical map, so the center column offers no Map button. */
  mapInRail?: boolean;
  onLeftToggle: () => void;
  onRightToggle: () => void;
  /**
   * Receives the story box, the area between the header and the dock. On a narrow screen the
   * layout portals the open rail and the floating buttons into it, so they stop above the
   * roll tray and the chat box instead of covering them (#2281).
   */
  storyBoxRef?: (el: HTMLDivElement | null) => void;
  showTracker: boolean;
  setShowTracker: (v: boolean) => void;
  isCombatDetected: boolean;
  isGeneratingGreeting: boolean;
  innerHandleAIResponse: (message: unknown) => Promise<void>;
  spellCastHandlerRef: SpellCastHandlerRef;
  lastSafetyCommand?: {
    type: 'x_card' | 'veil' | 'pause' | 'resume';
    timestamp: string;
    autoTriggered?: boolean;
  };
  contentWarnings: string[];
  comfortLevel: 'pg' | 'pg13' | 'r' | 'custom';
  showSafetyInfo: boolean;
  /**
   * #2517: tells the layout the fallen end state has replaced this column,
   * so the panels, tracker and floating controls leave the page too — the
   * end state is a page state, not an overlay over a live game.
   */
  onFallenChange?: (fallen: boolean) => void;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the main game area.
 * Since this component sits between the three primary layout panels, memoization
 * is critical for maintaining UI responsiveness during side panel toggles or
 * atmospheric background transitions.
 */
export const GameMainContent: React.FC<GameMainContentProps> = memo(
  ({
    sessionId,
    campaignIdForHandler,
    characterIdForHandler,
    sessionData,
    updateGameSessionState,
    showSceneBlurb,
    onSceneBlurbToggle,
    isLeftCollapsed,
    isRightCollapsed,
    mapInRail = false,
    onLeftToggle,
    onRightToggle,
    storyBoxRef,
    showTracker,
    setShowTracker,
    isCombatDetected,
    isGeneratingGreeting,
    innerHandleAIResponse,
    spellCastHandlerRef,
    lastSafetyCommand,
    contentWarnings,
    comfortLevel,
    showSafetyInfo,
    onFallenChange,
  }) => {
    const chatScrollRef = React.useRef<HTMLDivElement>(null);
    // The roll tray's element: in flow between the stream and the chat box (#2252).
    const [rollTraySlot, setRollTraySlot] = React.useState<HTMLDivElement | null>(null);
    // The tactical map never sits in this column. When the rail is not showing it, a Map
    // button opens it in a sheet over the stream only, so it can't cover the tray or input.
    const hasTacticalMap = Boolean(useTacticalMapContext()?.map);
    const [mapSheetOpen, setMapSheetOpen] = React.useState(false);
    const showMapButton = hasTacticalMap && !mapInRail;
    const showMapSheet = showMapButton && mapSheetOpen;
    // The sheet covers the card from its top down to the dock (tray + chat box), never lower.
    const cardRef = React.useRef<HTMLDivElement>(null);
    const dockRef = React.useRef<HTMLDivElement>(null);
    const mapSheetHeight = useHeightAboveDock(showMapSheet, cardRef, dockRef);
    const { queueStatus } = useMessageContext();
    // The pill covers the whole wait for the DM, not only the database write the queue reports
    // (#2418). A cast's result is shown by scrolling the feed to its newest card.
    const dmWaiting = useDmWaiting();
    const castPhase = useSheetCastProgress().cast?.phase;
    React.useEffect(() => {
      const feed = chatScrollRef.current;
      if (castPhase === 'done' && feed) feed.scrollTop = feed.scrollHeight;
    }, [castPhase]);
    const { state: gameState } = useGame();
    // #2517: when the terminal state arrives (death event, 409 restore,
    // reconnect re-check), this column is replaced by the fallen end state
    // and the layout is told so the rest of the game UI leaves the page.
    const [terminalUiState, setTerminalUiState] = React.useState<{ finalLines?: string[] } | null>(
      null,
    );
    const handleTerminalDeathStateChange = React.useCallback(
      (state: { finalLines?: string[] } | null) => {
        setTerminalUiState(state ? { finalLines: state.finalLines } : null);
      },
      [],
    );
    React.useEffect(() => {
      onFallenChange?.(terminalUiState !== null);
    }, [onFallenChange, terminalUiState]);
    // Queue state, not getCurrentDiceRoll(): that getter reads a ref and lags one render.
    // The queue's current roll is the only request with a visible control (the dice popup in
    // MessageListContainer), so it alone may raise the pill, the banner, and the input lock.
    // Rolls parsed from chat text have no popup; letting them lock the composer left a
    // "Roll required" banner with nothing to click (#2234).
    const queuedRoll = currentQueueRoll(gameState.diceRollQueue);
    const rollPillLabel = queuedRoll ? queueRollLabel(queuedRoll) : null;
    const rollBlocksInput = Boolean(rollPillLabel);
    const completionBanner = rollPillLabel
      ? `Please complete the ${rollPillLabel} roll above`
      : null;
    // Saved descriptions from before #2256 may still hold "⚙️ Engine:" lines.
    const sceneBlurb = stripEngineGeneratedLines(
      stripAssetTags(sessionData.current_scene_description || ''),
    );
    const overhaul = useOverhaulViewModel({
      chapterLabel: resolveCampaignChapterLabel(sessionData.turn_count),
      sceneBlurb,
    });

    if (terminalUiState) {
      return (
        <div
          className={`flex-1 min-w-0 min-h-0 ${isLeftCollapsed ? 'order-1' : 'order-2'} layout-main flex flex-col h-full`}
        >
          <FallenEndStateWithCharacter
            finalLines={terminalUiState.finalLines}
            sessionData={sessionData}
            campaignIdForHandler={campaignIdForHandler}
          />
        </div>
      );
    }

    return (
      <div
        className={`flex-1 min-w-0 min-h-0 ${isLeftCollapsed ? 'order-1' : 'order-2'} layout-main flex flex-col h-full`}
      >
        <Card
          ref={cardRef}
          className="ir-panel mobile-chat relative flex h-full flex-col overflow-hidden border border-white/10 bg-[linear-gradient(180deg,#0c1322,#0a0f1c)] shadow-2xl transition-all duration-300"
        >
          {/* The header is the one part that gives way on a short screen (it scrolls inside
              itself), so the roll tray and the chat box below never leave the viewport (#2252). */}
          <div className="relative min-h-0 overflow-y-auto border-b border-white/10 bg-[linear-gradient(180deg,#0e1626_0%,#0b1120_100%)]">
            <SceneHeader
              title={overhaul.scene.title}
              blurb={
                showSceneBlurb
                  ? overhaul.scene.blurb ||
                    'Your infinite story unfolds across realms of endless possibility...'
                  : overhaul.campaign.chapter
              }
              onSceneInfo={onSceneBlurbToggle}
              right={<Sword className="h-4 w-4 text-infinite-gold/80" aria-hidden="true" />}
            />
            <div
              className="relative flex flex-wrap items-center justify-between gap-3 border-t border-white/5 px-3 py-2"
              style={{ zIndex: Z_INDEX.DROPDOWN }}
            >
              <SafetyBanner
                isPaused={sessionData?.is_paused || false}
                lastSafetyCommand={lastSafetyCommand}
                contentWarnings={contentWarnings}
                comfortLevel={comfortLevel}
                showSafetyInfo={showSafetyInfo}
              />

              <div className="flex flex-wrap items-center justify-end gap-2">
                {/* Build + session id a player can quote (#2583). In this header row, so it adds
                    no height to the story column and can never reach the composer dock below. */}
                <BuildSessionStatus sessionId={sessionId} />
                <GamePanelControls
                  isLeftCollapsed={isLeftCollapsed}
                  isRightCollapsed={isRightCollapsed}
                  showSceneBlurb={showSceneBlurb}
                  onLeftToggle={onLeftToggle}
                  onRightToggle={onRightToggle}
                  onSceneBlurbToggle={onSceneBlurbToggle}
                />
                <TargetNumbersToggle />
                {showMapButton && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    aria-expanded={showMapSheet}
                    aria-controls="tactical-map-sheet"
                    onClick={() => setMapSheetOpen((open) => !open)}
                    className="border-infinite-gold/30 bg-white/[0.03] text-infinite-gold/90 hover:bg-infinite-gold/10"
                  >
                    <MapIcon className="h-4 w-4" aria-hidden="true" />
                    <span className="font-display font-medium">
                      {showMapSheet ? 'Hide map' : 'Map'}
                    </span>
                  </Button>
                )}
                <Button
                  variant={showTracker ? 'destructive' : 'outline'}
                  size="sm"
                  onClick={() => setShowTracker(!showTracker)}
                  className={`relative overflow-hidden transition-all duration-300 border-2 hover-glow focus-glow ${
                    showTracker
                      ? 'bg-gradient-to-r from-red-600 to-red-700 border-red-500 animate-pulse shadow-2xl'
                      : 'bg-white/[0.03] border-infinite-gold/30 text-infinite-gold/90 hover:bg-infinite-gold/10'
                  }`}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
                  <div className="relative flex items-center gap-2">
                    {showTracker ? (
                      <>
                        <X className="w-5 h-5" />
                        <span className="font-display font-medium">Close Tracker</span>
                      </>
                    ) : (
                      <>
                        <Sword className="w-5 h-5" />
                        <span className="font-display font-medium">Open Tracker</span>
                      </>
                    )}
                  </div>
                </Button>
              </div>
            </div>
            {isRightCollapsed && (
              <div className="flex items-center justify-center gap-3 border-t border-white/5 px-3 py-2 text-sm">
                <StatsBar />
              </div>
            )}
          </div>

          {/* Enhanced Content Area - Chat is always visible; tracker lives in a sheet */}
          {/* No min-h-0 here: this column's minimum is the stream's floor plus the tray plus the
              chat box, and the header above shrinks instead. */}
          <div className="flex-1 flex flex-col relative bg-gradient-to-b from-card/60 via-card/40 to-card/60 transition-all duration-300">
            {/* HUD Banner when combat is active/detected */}
            {isCombatDetected && (
              <div
                className={`mx-3 mt-3 mb-1 px-3 py-2 bg-red-50 border border-red-200 rounded-md items-center justify-between ${
                  // At phone width the tray is the fight's state while a roll is pending, and the
                  // header already has Open Tracker; the space goes to the story instead.
                  rollPillLabel ? 'hidden sm:flex' : 'flex'
                }`}
              >
                <div className="text-sm text-red-700 font-medium">⚔️ Combat in progress</div>
                <Button size="sm" variant="outline" onClick={() => setShowTracker(true)}>
                  Open Tracker
                </Button>
              </div>
            )}

            <MessageHandler
              sessionId={sessionId}
              campaignId={campaignIdForHandler || null}
              characterId={characterIdForHandler}
              turnCount={sessionData.turn_count ?? 0}
              updateGameSessionState={updateGameSessionState}
              onAIResponse={innerHandleAIResponse}
              spellCastHandlerRef={spellCastHandlerRef}
              onTerminalDeathStateChange={handleTerminalDeathStateChange}
            >
              {({
                handleSendMessage,
                isProcessing,
                isReconnecting,
                isStillThinking,
                attackWaitLabel,
                sendError,
                onRetry,
                combatTurnUiState,
                onResumeTurn,
              }) => (
                <RollTraySlotProvider value={rollTraySlot}>
                  {/* min-h-24: the newest story line keeps a place above the tray. contain:size keeps the
                      story's length out of this column's minimum height. */}
                  <div
                    ref={storyBoxRef}
                    data-testid="story-box"
                    className="relative flex min-h-24 flex-1 flex-col overflow-hidden [contain:size]"
                  >
                    <CombatTurnBarLive turnInFlight={isProcessing} />
                    <MessageList
                      onSendFullMessage={handleSendMessage}
                      sessionId={sessionId}
                      containerRef={chatScrollRef}
                      suppressEmptyState={isGeneratingGreeting}
                    />
                    <TimelineRail rootRef={chatScrollRef} />
                  </div>

                  {/* Enhanced loading indicator for initial greeting */}
                  {isGeneratingGreeting && (
                    <div
                      className="absolute inset-0 bg-background/80 backdrop-blur-md flex items-center justify-center animate-in fade-in duration-300"
                      style={{ zIndex: Z_INDEX.CARD_HOVER }}
                    >
                      <div className="bg-card border border-border/60 rounded-xl p-8 shadow-2xl max-w-md mx-4 transform animate-in slide-in-from-bottom-4 duration-500">
                        <div className="flex flex-col items-center text-center space-y-6">
                          <div className="relative">
                            <div className="w-16 h-16 bg-gradient-to-br from-infinite-gold via-infinite-teal to-infinite-gold rounded-full flex items-center justify-center animate-pulse shadow-lg">
                              <span className="text-3xl">🎭</span>
                            </div>
                            <div className="absolute -inset-1 bg-gradient-to-r from-infinite-gold to-infinite-teal rounded-full blur opacity-30 animate-ping"></div>
                          </div>
                          <div className="space-y-3">
                            <h3 className="text-lg font-semibold text-card-foreground">
                              Crafting Opening Scene
                            </h3>
                            <p className="text-sm text-muted-foreground leading-relaxed">
                              The Dungeon Master is generating your personalized adventure
                              introduction based on your character and campaign.
                            </p>
                          </div>
                          <div className="flex items-center justify-center gap-1">
                            <div className="w-2 h-2 bg-infinite-gold rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-2 h-2 bg-infinite-teal rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-2 h-2 bg-infinite-gold rounded-full animate-bounce"></div>
                          </div>
                          <div className="w-8 h-8 border-2 border-infinite-gold/20 border-t-infinite-gold rounded-full animate-spin"></div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* A pending roll's status sits with the tray below; this is only the DM wait. */}
                  {!rollPillLabel && (dmWaiting || queueStatus === 'processing') && (
                    <div
                      className="absolute bottom-24 left-6 animate-in slide-in-from-left-2 duration-300 md:bottom-20"
                      style={{ zIndex: Z_INDEX.DROPDOWN }}
                    >
                      <div className="flex items-center gap-3 px-4 py-2 bg-card/90 backdrop-blur-sm border border-border/60 rounded-full shadow-lg">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-infinite-gold to-infinite-teal flex items-center justify-center">
                          <span className="text-xs font-medium text-white">DM</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 bg-infinite-gold rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-1.5 h-1.5 bg-infinite-teal rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-1.5 h-1.5 bg-infinite-gold rounded-full animate-bounce"></div>
                        </div>
                        <span className="text-xs text-muted-foreground font-medium">
                          Dungeon Master is thinking...
                        </span>
                      </div>
                    </div>
                  )}

                  {!rollPillLabel &&
                    (['unknown', 'failed', 'running'] as CombatTurnPreflightStatus[]).includes(
                      combatTurnUiState.preflight,
                    ) && (
                      <div
                        className="border-t border-amber-200 bg-amber-50 p-3"
                        role="status"
                        aria-live="polite"
                      >
                        <div className="flex items-center justify-between gap-3 text-amber-800">
                          <span className="text-sm font-medium">
                            {combatTurnUiState.preflight === 'running'
                              ? 'Checking whose turn it is…'
                              : combatTurnUiState.preflight === 'failed'
                                ? `Combat turn refresh failed: ${combatTurnUiState.error ?? 'Unknown error.'}`
                                : 'Combat turn state needs to be refreshed.'}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label="Resume turn"
                            onClick={() => void onResumeTurn()}
                            disabled={combatTurnUiState.preflight === 'running'}
                          >
                            {combatTurnUiState.preflight === 'running'
                              ? 'Resuming…'
                              : 'Resume turn'}
                          </Button>
                        </div>
                      </div>
                    )}

                  {/* The dock: roll tray, roll status and chat box, in flow at the bottom. */}
                  <div ref={dockRef} className="shrink-0">
                    {/* The roll tray: the dice prompt is portaled in here (see roll-tray-slot). */}
                    <div
                      ref={setRollTraySlot}
                      data-testid="roll-tray-slot"
                      className="empty:hidden"
                    />

                    {/* One line, in flow, from the same queue roll that fills the tray, so it
                      exists only while the tray does (#2234). */}
                    {rollPillLabel && (
                      <div
                        className="hidden border-t border-infinite-gold/20 bg-infinite-dark/60 px-3 py-1.5 sm:block"
                        role="status"
                        aria-live="polite"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-infinite-gold">
                          <Dice6 className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="font-semibold">Your roll: {rollPillLabel}</span>
                          <Badge variant="warning">Roll required</Badge>
                          <span className="text-muted-foreground">{completionBanner}</span>
                        </div>
                      </div>
                    )}

                    {/* Input Area at bottom. In flow, not sticky: a sticky chat box sat on top of the
                      tray's buttons whenever the column ran out of room. #2517: when the character
                      has fallen this whole column is replaced by the end state above, so the
                      composer is never left live under a death screen. */}
                    <div
                      className="relative border-t border-border/60 bg-card/70 backdrop-blur-sm pb-4 md:pb-[env(safe-area-inset-bottom)]"
                      style={{ zIndex: Z_INDEX.STICKY }}
                    >
                      <DyingComposerSlot
                        onSendMessage={handleSendMessage}
                        isProcessing={isProcessing}
                        promptOpen={rollBlocksInput}
                      >
                        <ChatInput
                          onSendMessage={handleSendMessage}
                          isReconnecting={isReconnecting}
                          isStillThinking={isStillThinking}
                          attackWaitLabel={rollBlocksInput ? null : attackWaitLabel}
                          sendError={sendError ?? undefined}
                          onRetry={onRetry}
                          disabledReason={
                            rollBlocksInput && !isProcessing
                              ? 'Roll the dice above to continue'
                              : undefined
                          }
                          isDisabled={
                            isProcessing ||
                            rollBlocksInput ||
                            combatTurnUiState.preflight === 'unknown' ||
                            combatTurnUiState.preflight === 'failed' ||
                            combatTurnUiState.preflight === 'running'
                          }
                        />
                      </DyingComposerSlot>
                    </div>
                  </div>
                </RollTraySlotProvider>
              )}
            </MessageHandler>
          </div>

          {showMapSheet && (
            <div
              id="tactical-map-sheet"
              role="dialog"
              aria-modal="false"
              aria-label="Tactical map"
              className="absolute inset-x-0 top-0 flex flex-col overflow-y-auto border-b border-infinite-gold/25 bg-infinite-dark/95 backdrop-blur-sm"
              style={
                {
                  zIndex: Z_INDEX.CARD_HOVER,
                  height: mapSheetHeight ?? undefined,
                  // The canvas sizes itself to fit the sheet (see canvasClassName below).
                  '--map-sheet-h': mapSheetHeight == null ? undefined : `${mapSheetHeight}px`,
                } as React.CSSProperties
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') setMapSheetOpen(false);
              }}
            >
              <div className="flex justify-end px-3 pt-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setMapSheetOpen(false)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  Close map
                </Button>
              </div>
              <TacticalMapBoard
                sessionId={sessionId}
                className="mx-3 mb-3"
                canvasClassName="h-[max(8rem,min(52vh,520px,calc(var(--map-sheet-h,100vh)_-_6rem)))]"
              />
            </div>
          )}
        </Card>
      </div>
    );
  },
);
