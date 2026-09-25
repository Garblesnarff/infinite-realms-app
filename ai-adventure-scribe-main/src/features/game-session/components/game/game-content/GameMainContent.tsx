import { Dice6, Sword, X } from 'lucide-react';
import React, { memo } from 'react';

import { GamePanelControls } from './GamePanelControls';
import { currentQueueRoll, queueRollLabel } from './queue-roll-label';
import { ChatInput } from '../../chat/ChatInput';
import { MessageList } from '../../chat/MessageList';
import { TacticalMapBoard } from '../../tactical/TacticalMapBoard';
import { MessageHandler } from '../message/MessageHandler';
import { resolveCampaignChapterLabel } from '../overhaul/campaign-chapter';
import { SceneHeader } from '../overhaul/SceneHeader';
import { useOverhaulViewModel } from '../overhaul/useOverhaulViewModel';
import { StatsBar } from '../StatsBar';
import { TimelineRail } from '../TimelineRail';

import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { CombatTurnPreflightStatus } from '@/hooks/ai/combat-turn-preflight';
import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { CombatStatus } from '@/components/combat/CombatStatus';
import { SafetyBanner } from '@/components/safety/SafetyBanner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useGame } from '@/contexts/GameContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { stripAssetTags } from '@/lib/utils';

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
  onLeftToggle: () => void;
  onRightToggle: () => void;
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
    onLeftToggle,
    onRightToggle,
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
  }) => {
    const chatScrollRef = React.useRef<HTMLDivElement>(null);
    const { queueStatus } = useMessageContext();
    const { state: gameState } = useGame();
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
    const sceneBlurb = stripAssetTags(sessionData.current_scene_description || '');
    const overhaul = useOverhaulViewModel({
      chapterLabel: resolveCampaignChapterLabel(sessionData.turn_count),
      sceneBlurb,
    });

    return (
      <div
        className={`flex-1 min-w-0 min-h-0 ${isLeftCollapsed ? 'order-1' : 'order-2'} layout-main flex flex-col h-full`}
      >
        <Card className="ir-panel mobile-chat flex h-full flex-col overflow-hidden border border-white/10 bg-[linear-gradient(180deg,#0c1322,#0a0f1c)] shadow-2xl transition-all duration-300">
          <div className="relative border-b border-white/10 bg-[linear-gradient(180deg,#0e1626_0%,#0b1120_100%)]">
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
                <GamePanelControls
                  isLeftCollapsed={isLeftCollapsed}
                  isRightCollapsed={isRightCollapsed}
                  showSceneBlurb={showSceneBlurb}
                  onLeftToggle={onLeftToggle}
                  onRightToggle={onRightToggle}
                  onSceneBlurbToggle={onSceneBlurbToggle}
                />
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
                <CombatStatus />
              </div>
            )}
          </div>

          {/* Enhanced Content Area - Chat is always visible; tracker lives in a sheet */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-gradient-to-b from-card/60 via-card/40 to-card/60 transition-all duration-300">
            {/* HUD Banner when combat is active/detected */}
            {isCombatDetected && (
              <div className="mx-3 mt-3 mb-1 px-3 py-2 bg-red-50 border border-red-200 rounded-md flex items-center justify-between">
                <div className="text-sm text-red-700 font-medium">⚔️ Combat in progress</div>
                <Button size="sm" variant="outline" onClick={() => setShowTracker(true)}>
                  Open Tracker
                </Button>
              </div>
            )}

            <TacticalMapBoard sessionId={sessionId} />

            <MessageHandler
              sessionId={sessionId}
              campaignId={campaignIdForHandler || null}
              characterId={characterIdForHandler}
              turnCount={sessionData.turn_count ?? 0}
              updateGameSessionState={updateGameSessionState}
              onAIResponse={innerHandleAIResponse}
              spellCastHandlerRef={spellCastHandlerRef}
            >
              {({
                handleSendMessage,
                isProcessing,
                isReconnecting,
                combatTurnUiState,
                onResumeTurn,
              }) => (
                <>
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden relative">
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

                  {/* Roll requests take priority over the generic processing status. */}
                  {rollPillLabel ? (
                    <div
                      className="absolute bottom-24 left-6 animate-in slide-in-from-left-2 duration-300 md:bottom-20"
                      style={{ zIndex: Z_INDEX.DROPDOWN }}
                      role="status"
                      aria-live="polite"
                    >
                      <div className="flex items-center gap-3 rounded-full border border-orange-300/70 bg-orange-50/95 px-4 py-2 shadow-lg backdrop-blur-sm">
                        <Dice6
                          className="h-5 w-5 animate-pulse text-orange-600"
                          aria-hidden="true"
                        />
                        <span className="text-sm font-semibold text-orange-800">
                          Your roll: {rollPillLabel}
                        </span>
                        <Badge variant="warning" className="animate-pulse">
                          Roll required
                        </Badge>
                      </div>
                    </div>
                  ) : (
                    queueStatus === 'processing' && (
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
                    )
                  )}

                  {/* Same label as the pill, from the same queue roll. */}
                  {completionBanner && (
                    <div className="border-t border-orange-200 bg-orange-50 p-3">
                      <div className="flex items-center gap-2 text-orange-700">
                        <Dice6 className="w-4 h-4" />
                        <span className="text-sm font-medium">{completionBanner}</span>
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

                  {/* Input Area at bottom - sticky */}
                  <div
                    className="border-t border-border/60 bg-card/70 backdrop-blur-sm pb-4 md:pb-[env(safe-area-inset-bottom)] sticky bottom-0 left-0 right-0 shrink-0"
                    style={{ zIndex: Z_INDEX.STICKY }}
                  >
                    <ChatInput
                      onSendMessage={handleSendMessage}
                      isReconnecting={isReconnecting}
                      isDisabled={
                        isProcessing ||
                        rollBlocksInput ||
                        combatTurnUiState.preflight === 'unknown' ||
                        combatTurnUiState.preflight === 'failed' ||
                        combatTurnUiState.preflight === 'running'
                      }
                    />
                  </div>
                </>
              )}
            </MessageHandler>
          </div>
        </Card>
      </div>
    );
  },
);
