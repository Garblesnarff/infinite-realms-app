/* eslint-disable max-lines */
import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { GameLoadingOverlay, GameLayout } from './game-content';
import GameProviders from './GameProviders';
import { useGameData } from './useGameData';

import type { SpellCastHandlerRef } from './spell-cast-handler';
import type { ExtendedGameSession, SessionStateUpdater } from '@/hooks/game-session/session-utils';
import type { ChatMessage } from '@/types/game';

import { Button } from '@/components/ui/button';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCombat } from '@/contexts/CombatContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useGameSession } from '@/hooks/use-game-session';
import { useInitialGreeting } from '@/hooks/use-initial-greeting';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { useStaleClientCheck } from '@/hooks/use-stale-client-check';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { handleAsyncError } from '@/utils/error-handler';
import { hasStarterPlaythroughSignal } from '@/utils/starter-playthrough';

type GameAIResponse = ChatMessage;

/**
 * GameContent Component
 *
 * Main component for the game interface. Handles data loading, session management,
 * and provides context providers. Delegates UI rendering to GameLayout sub-component.
 */
const GameContent: React.FC = () => {
  const { id: campaignIdFromParams } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const characterIdFromParams = searchParams.get('character');
  const forceNew = searchParams.get('new') === 'true';
  const specificSessionId = searchParams.get('session') || undefined;
  const starterCampaignIdFromParams = searchParams.get('starterCampaign') || undefined;
  const { state: campaignState } = useCampaign();

  // BUG FIX: page refresh was creating a new session instead of resuming.
  // `?new=true` is added to the URL by the campaign hub/character-selection
  // flow to force creation of a fresh session on first navigation, but it was
  // never removed afterward - so refreshing the page (URL unchanged) re-ran
  // the forceNew path on mount and silently abandoned the in-progress
  // session for a brand-new one. Once useSessionInitialization confirms the
  // new session was created, strip the param via replace so a refresh takes
  // the normal resume path instead.
  const clearForceNewParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [setSearchParams]);

  // Initialize game session
  const { sessionData, sessionId, sessionState, updateGameSessionState } = useGameSession(
    campaignIdFromParams,
    characterIdFromParams || undefined,
    forceNew,
    specificSessionId,
    starterCampaignIdFromParams,
    clearForceNewParam,
  );

  // Load character and campaign data
  const { isLoading, loadingPhase, error, isDM } = useGameData(
    characterIdFromParams,
    campaignIdFromParams,
  );

  const isStarterPlaythrough =
    Boolean(starterCampaignIdFromParams) ||
    hasStarterPlaythroughSignal(campaignState.campaign) ||
    hasStarterPlaythroughSignal(sessionData);
  const missingStarterCampaignId = Boolean(
    sessionId && sessionData && !sessionData.starter_campaign_id && isStarterPlaythrough,
  );

  useEffect(() => {
    if (!missingStarterCampaignId || !sessionId) return;

    const message = 'Missing required starter_campaign_id for game session';
    logger.error('[GameContent] Missing required starter_campaign_id', { sessionId });
    userDataApi.reportClientFailure('missing_starter_campaign_id', sessionId, message);
  }, [missingStarterCampaignId, sessionId]);

  const [combatMode, setCombatMode] = useState(false);
  const [showSceneBlurb, setShowSceneBlurb] = useLocalStorage('ui:sceneBlurb', true);

  const handleCombatToggle = useCallback(() => {
    setCombatMode((v) => !v);
    sessionStorage.setItem('manualCombatToggle', 'true');
    setTimeout(() => sessionStorage.removeItem('manualCombatToggle'), 30000);
  }, []);

  const handleAIResponse = useCallback(async (message: GameAIResponse) => {
    logger.info(
      'AI response received in outer component:',
      message.text?.substring(0, 100) + '...',
    );
  }, []);

  // ⚡ Bolt: Stable callback for scene blurb toggle
  const handleSceneBlurbToggle = useCallback(() => {
    setShowSceneBlurb((v) => !v);
  }, [setShowSceneBlurb]);

  // Combine loading states
  const combinedIsLoading = isLoading || sessionState === 'loading';
  const combinedError = error || (sessionState === 'error' ? 'Error with game session.' : null);

  if (combinedIsLoading) {
    return <GameLoadingOverlay loadingPhase={loadingPhase} />;
  }

  if (combinedError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-10 max-w-md">
          <div className="text-destructive mb-4">Error: {combinedError}</div>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (!sessionId || !sessionData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-10 max-w-md">
          <div className="text-muted-foreground mb-4">
            Initializing your infinite story... If this persists, check campaign/character
            selection.
          </div>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (missingStarterCampaignId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-10 max-w-md">
          <div className="text-destructive mb-4">
            This game session is missing its required starter campaign link.
          </div>
          <Button onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </div>
    );
  }

  const effectiveStarterCampaignId = sessionData.starter_campaign_id || null;

  return (
    <GameProviders
      sessionId={sessionId}
      starterCampaignId={effectiveStarterCampaignId}
      characterId={characterIdFromParams}
    >
      <GameContentInner
        sessionId={sessionId}
        campaignIdForHandler={campaignIdFromParams ?? null}
        characterIdForHandler={characterIdFromParams ?? null}
        sessionData={sessionData}
        updateGameSessionState={updateGameSessionState}
        combatMode={combatMode}
        setCombatMode={setCombatMode}
        handleCombatToggle={handleCombatToggle}
        handleAIResponse={handleAIResponse}
        isDM={isDM}
        showSceneBlurb={showSceneBlurb}
        onSceneBlurbToggle={handleSceneBlurbToggle}
      />
    </GameProviders>
  );
};

// Inner component with access to all context providers
interface GameContentInnerProps {
  sessionId: string;
  campaignIdForHandler: string | null;
  characterIdForHandler: string | null;
  sessionData: ExtendedGameSession;
  updateGameSessionState: (newState: SessionStateUpdater) => Promise<void>;
  combatMode: boolean;
  setCombatMode: (mode: boolean) => void;
  handleCombatToggle: () => void;
  handleAIResponse: (message: GameAIResponse) => Promise<void>;
  isDM: boolean;
  showSceneBlurb: boolean;
  onSceneBlurbToggle: () => void;
}

const GameContentInner: React.FC<GameContentInnerProps> = ({
  sessionId,
  campaignIdForHandler,
  characterIdForHandler,
  sessionData,
  updateGameSessionState,
  combatMode,
  isDM,
  showSceneBlurb,
  onSceneBlurbToggle,
  handleAIResponse,
}) => {
  // Navy+gold overhaul: show the rich side rails by default on any reasonable
  // desktop; only auto-collapse on narrow/mobile widths. Keys bumped to v2 so
  // existing users pick up the new default instead of a stale collapsed value.
  const getDefaultLeftCollapsed = () => typeof window !== 'undefined' && window.innerWidth < 1024;
  const getDefaultRightCollapsed = () => typeof window !== 'undefined' && window.innerWidth < 1024;

  const [isLeftCollapsed, setIsLeftCollapsed] = useLocalStorage(
    'ui:leftPanelCollapsed:v2',
    getDefaultLeftCollapsed(),
  );
  const [isRightCollapsed, setIsRightCollapsed] = useLocalStorage(
    'ui:rightPanelCollapsed:v2',
    getDefaultRightCollapsed(),
  );
  const [isCombatDetected, setIsCombatDetected] = useState(false);
  const [showTracker, setShowTracker] = useState(false);
  const spellCastHandlerRef = React.useRef<SpellCastHandlerRef['current']>(null);

  // Safety state (placeholder values for future implementation)
  const [lastSafetyCommand] = useState<
    | { type: 'x_card' | 'veil' | 'pause' | 'resume'; timestamp: string; autoTriggered?: boolean }
    | undefined
  >();
  const [contentWarnings] = useState<string[]>([]);
  const [comfortLevel] = useState<'pg' | 'pg13' | 'r' | 'custom'>('pg13');
  const [showSafetyInfo] = useState(false);

  const { messages, sendMessage, messagesLoading } = useMessageContext();
  const { createMemory } = useMemoryContext();

  const combatAI = useCombatAIIntegration({
    sessionId,
    characterId: characterIdForHandler || undefined,
    campaignId: campaignIdForHandler || undefined,
  });
  const { state: combatState } = useCombat();
  const prevInCombatRef = React.useRef(combatState.isInCombat);

  useStaleClientCheck({ isInCombat: combatState.isInCombat, sessionId });

  const { isGenerating: isGeneratingGreeting } = useInitialGreeting({
    sessionId,
    sessionData,
    characterId: characterIdForHandler,
    campaignId: campaignIdForHandler,
    messages,
    messagesLoading,
    onGreetingGenerated: sendMessage,
    onMemoryCreated: async (memory) => {
      try {
        await createMemory(memory);
      } catch (e) {
        handleAsyncError(e, {
          userMessage: 'Failed to save greeting memory',
          logLevel: 'warn',
          showToast: false,
          context: { location: 'GameContent.onMemoryCreated' },
        });
      }
    },
  });

  React.useEffect(() => {
    setIsCombatDetected(!!combatAI.isInCombat);
  }, [combatAI.isInCombat]);

  const innerHandleAIResponse = React.useCallback(
    async (message: GameAIResponse) => {
      try {
        logger.info(
          'Processing AI response for combat detection:',
          message.text?.substring(0, 100) + '...',
        );

        await handleAIResponse(message);
      } catch (error) {
        handleAsyncError(error, {
          userMessage: 'Failed to process AI response for combat',
          context: { location: 'GameContent.onAIResponseWithCombat' },
        });
      }
    },
    [handleAIResponse],
  );

  React.useEffect(() => {
    if (prevInCombatRef.current && !combatState.isInCombat) {
      const enc = combatState.activeEncounter;
      const rounds = enc?.currentRound || enc?.roundsElapsed || 1;
      const participants = (enc?.participants || []).map((p) => ({
        name: p.name,
        damageDealt: (enc?.actions || [])
          .filter((a) => a.participantId === p.id && a.damageDealt)
          .reduce((s, a) => s + (a.damageDealt || 0), 0),
        damageTaken: Math.max(0, (p.maxHitPoints || 0) - (p.currentHitPoints || 0)),
        status: p.isDead ? 'dead' : p.isUnconscious ? 'unconscious' : 'ok',
      }));
      const totalDamage = participants.reduce((s, x) => s + x.damageDealt, 0);
      sendMessage({
        text: 'Combat has ended.',
        sender: 'system',
        context: {
          combatData: {
            type: 'summary',
            summary: { rounds, totalDamage, participants, outcome: 'Combat concluded' },
          },
        },
      });
      setShowTracker(false);
    }
    prevInCombatRef.current = combatState.isInCombat;
  }, [combatState.isInCombat, combatState.activeEncounter, sendMessage]);

  // ⚡ Bolt: Stable callback for scene blurb toggle
  const handleSceneBlurbToggle = useCallback(() => {
    onSceneBlurbToggle();
  }, [onSceneBlurbToggle]);

  return (
    <GameLayout
      sessionId={sessionId}
      campaignIdForHandler={campaignIdForHandler}
      characterIdForHandler={characterIdForHandler}
      sessionData={sessionData}
      updateGameSessionState={updateGameSessionState}
      isLeftCollapsed={isLeftCollapsed}
      isRightCollapsed={isRightCollapsed}
      setIsLeftCollapsed={setIsLeftCollapsed}
      setIsRightCollapsed={setIsRightCollapsed}
      showSceneBlurb={showSceneBlurb}
      onSceneBlurbToggle={handleSceneBlurbToggle}
      combatMode={combatMode}
      showTracker={showTracker}
      setShowTracker={setShowTracker}
      isCombatDetected={isCombatDetected}
      isGeneratingGreeting={isGeneratingGreeting}
      innerHandleAIResponse={innerHandleAIResponse}
      isDM={isDM}
      spellCastHandlerRef={spellCastHandlerRef}
      lastSafetyCommand={lastSafetyCommand}
      contentWarnings={contentWarnings}
      comfortLevel={comfortLevel}
      showSafetyInfo={showSafetyInfo}
    />
  );
};

export default GameContent;
