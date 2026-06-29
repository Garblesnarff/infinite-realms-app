import { Dice6, Sword, X } from 'lucide-react';
import React, { memo } from 'react';

import { ChatInput } from '../../chat/ChatInput';
import { MessageList } from '../../chat/MessageList';
import { MessageHandler } from '../message/MessageHandler';
import { StatsBar } from '../StatsBar';
import { TimelineRail } from '../TimelineRail';
import { GamePanelControls } from './GamePanelControls';

import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';

import { CombatStatus } from '@/components/combat/CombatStatus';
import { SafetyBanner } from '@/components/safety/SafetyBanner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Z_INDEX } from '@/constants/z-index';
import { useCampaign } from '@/contexts/CampaignContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { usePendingRolls } from '@/hooks/use-pending-rolls';
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
export const GameMainContent: React.FC<GameMainContentProps> = memo(({
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
  lastSafetyCommand,
  contentWarnings,
  comfortLevel,
  showSafetyInfo,
}) => {
  const chatScrollRef = React.useRef<HTMLDivElement>(null);
  const { queueStatus } = useMessageContext();
  const { hasPendingRolls, pendingRequests } = usePendingRolls();
  const { state: campaignState } = useCampaign();

  return (
    <div
      className={`flex-1 min-w-0 min-h-0 ${isLeftCollapsed ? 'order-1' : 'order-2'} layout-main flex flex-col h-full`}
    >
      <Card className="ir-panel flex flex-col shadow-2xl border border-white/10 overflow-hidden transition-all duration-300 mobile-chat h-full bg-[linear-gradient(180deg,#0c1322,#0a0f1c)]">
        {/* Enhanced Cinematic Header with Improved Visual Hierarchy */}
        <div className="relative p-3 md:p-4 border-b border-white/10 bg-[linear-gradient(180deg,#0e1626_0%,#0b1120_100%)] overflow-hidden transition-all duration-300">

          <div
            className="relative flex flex-col lg:flex-row lg:items-center justify-between animate-in fade-in slide-in-from-top-4 duration-700 gap-4 md:gap-6"
            style={{ zIndex: Z_INDEX.DROPDOWN }}
          >
            <div className="flex-1 min-w-0 text-center lg:px-4">
              <h1 className="ir-display text-xl md:text-2xl font-bold tracking-wide mb-1 truncate text-foreground">
                {campaignState?.campaign?.name || 'InfiniteRealms Adventure'}
              </h1>
              <div className="flex items-center justify-center">
                <span className="ir-display text-[11px] font-semibold uppercase tracking-[1.6px] text-infinite-gold/80">
                  Chapter {sessionData.turn_count ?? 0}
                </span>
              </div>
              {showSceneBlurb && (
                <p className="ir-narr text-sm text-foreground/70 mt-1 line-clamp-2 max-w-2xl mx-auto">
                  {stripAssetTags(sessionData.current_scene_description || '') ||
                    'Your infinite story unfolds across realms of endless possibility...'}
                </p>
              )}
              {/* Stats are shown in the right character sheet; surface here only when it's hidden */}
              {isRightCollapsed && (
                <div className="flex items-center justify-center gap-3 text-sm mt-2">
                  <StatsBar />
                  <CombatStatus />
                </div>
              )}
            </div>

            {/* Safety Banner */}
            <SafetyBanner
              isPaused={sessionData?.is_paused || false}
              lastSafetyCommand={lastSafetyCommand}
              contentWarnings={contentWarnings}
              comfortLevel={comfortLevel}
              showSafetyInfo={showSafetyInfo}
            />

            {/* Sidebar Toggles + Tracker */}
            <div className="flex flex-col md:flex-row items-center gap-3 md:gap-4 md:ml-8 w-full md:w-auto">
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
                size="lg"
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

          <MessageHandler
            sessionId={sessionId}
            campaignId={campaignIdForHandler || null}
            characterId={characterIdForHandler}
            turnCount={sessionData.turn_count ?? 0}
            updateGameSessionState={updateGameSessionState}
            onAIResponse={innerHandleAIResponse}
          >
            {({ handleSendMessage, isProcessing }) => (
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
                          <div className="w-16 h-16 bg-gradient-to-br from-infinite-purple via-infinite-teal to-infinite-purple rounded-full flex items-center justify-center animate-pulse shadow-lg">
                            <span className="text-3xl">🎭</span>
                          </div>
                          <div className="absolute -inset-1 bg-gradient-to-r from-infinite-purple to-infinite-teal rounded-full blur opacity-30 animate-ping"></div>
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
                          <div className="w-2 h-2 bg-infinite-purple rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                          <div className="w-2 h-2 bg-infinite-teal rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                          <div className="w-2 h-2 bg-infinite-purple rounded-full animate-bounce"></div>
                        </div>
                        <div className="w-8 h-8 border-2 border-infinite-purple/20 border-t-infinite-purple rounded-full animate-spin"></div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Typing Indicator - shows when AI is responding */}
                {queueStatus === 'processing' && (
                  <div
                    className="absolute bottom-24 left-6 animate-in slide-in-from-left-2 duration-300 md:bottom-20"
                    style={{ zIndex: Z_INDEX.DROPDOWN }}
                  >
                    <div className="flex items-center gap-3 px-4 py-2 bg-card/90 backdrop-blur-sm border border-border/60 rounded-full shadow-lg">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-infinite-purple to-infinite-teal flex items-center justify-center">
                        <span className="text-xs font-medium text-white">DM</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-1.5 h-1.5 bg-infinite-purple rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                        <div className="w-1.5 h-1.5 bg-infinite-teal rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                        <div className="w-1.5 h-1.5 bg-infinite-purple rounded-full animate-bounce"></div>
                      </div>
                      <span className="text-xs text-muted-foreground font-medium">
                        Dungeon Master is thinking...
                      </span>
                    </div>
                  </div>
                )}

                {/* Pending Roll Indicator */}
                {hasPendingRolls && (
                  <div className="border-t border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-center gap-2 text-orange-700">
                      <Dice6 className="w-4 h-4" />
                      <span className="text-sm font-medium">
                        {pendingRequests.length === 1
                          ? `Please complete the ${pendingRequests[0].type} roll above`
                          : `Please complete ${pendingRequests.length} pending rolls above`}
                      </span>
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
                    isDisabled={isProcessing || hasPendingRolls}
                  />
                </div>
              </>
            )}
          </MessageHandler>
        </div>
      </Card>
    </div>
  );
});
