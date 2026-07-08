/* eslint-disable @typescript-eslint/no-explicit-any, max-lines */
import React, { useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

import { GameLoadingOverlay, GameLayout } from './game-content';
import GameProviders from './GameProviders';
import { useGameData } from './useGameData';

import { Button } from '@/components/ui/button';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { useMemoryContext } from '@/contexts/MemoryContext';
import { useMessageContext } from '@/contexts/MessageContext';
import { useCombatAIIntegration } from '@/hooks/use-combat-ai-integration';
import { useGameSession } from '@/hooks/use-game-session';
import { useInitialGreeting } from '@/hooks/use-initial-greeting';
import { useLocalStorage } from '@/hooks/use-local-storage';
import logger from '@/lib/logger';
import { handleAsyncError } from '@/utils/error-handler';

/**
 * GameContent Component
 *
 * Main component for the game interface. Handles data loading, session management,
 * and provides context providers. Delegates UI rendering to GameLayout sub-component.
 */
const GameContent: React.FC = () => {
  const { id: campaignIdFromParams } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const characterIdFromParams = searchParams.get('character');
  const forceNew = searchParams.get('new') === 'true';
  const specificSessionId = searchParams.get('session') || undefined;
  const starterCampaignIdFromParams = searchParams.get('starterCampaign') || undefined;

  const { state: characterState } = useCharacter();
  const { state: campaignState } = useCampaign();

  // Initialize game session
  const { sessionData, sessionId, sessionState, updateGameSessionState } = useGameSession(
    campaignIdFromParams,
    characterIdFromParams || undefined,
    forceNew,
    specificSessionId,
    starterCampaignIdFromParams,
  );

  // Load character and campaign data
  const { isLoading, loadingPhase, error, isDM } = useGameData(
    characterIdFromParams,
    campaignIdFromParams,
  );

  const [combatMode, setCombatMode] = useState(false);
  const [showSceneBlurb, setShowSceneBlurb] = useLocalStorage('ui:sceneBlurb', true);

  const handleCombatToggle = useCallback(() => {
    setCombatMode((v) => !v);
    sessionStorage.setItem('manualCombatToggle', 'true');
    setTimeout(() => sessionStorage.removeItem('manualCombatToggle'), 30000);
  }, []);

  const handleAIResponse = useCallback(async (message: any) => {
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

  // Infer starter campaign ID from URL params, session data, or campaign name
  const campaignNameToSlug: Record<string, string> = {
    'The Eternal Feast': 'the-eternal-feast',
    'The Academy of Arcane Gastronomy': 'the-academy-of-arcane-gastronomy',
    'Abyssal Descent': 'abyssal-descent',
  };
  const inferredStarterCampaignId = campaignState?.campaign?.name
    ? campaignNameToSlug[campaignState.campaign.name]
    : undefined;
  const effectiveStarterCampaignId =
    starterCampaignIdFromParams ||
    sessionData?.starter_campaign_id ||
    inferredStarterCampaignId ||
    null;

  return (
    <GameProviders sessionId={sessionId} starterCampaignId={effectiveStarterCampaignId} characterId={characterIdFromParams}>
      <GameContentInner
        sessionId={sessionId}
        campaignIdForHandler={campaignIdFromParams ?? null}
        characterIdForHandler={characterIdFromParams ?? null}
        sessionData={sessionData}
        updateGameSessionState={updateGameSessionState}
        characterState={characterState}
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
  sessionData: any;
  updateGameSessionState: any;
  characterState: any;
  combatMode: boolean;
  setCombatMode: (mode: boolean) => void;
  handleCombatToggle: () => void;
  handleAIResponse: (message: any) => Promise<void>;
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
  characterState,
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
    async (message: any) => {
      try {
        logger.info(
          'Processing AI response for combat detection:',
          message.text?.substring(0, 100) + '...',
        );

        if (message.combatDetection) {
          logger.info('Combat detection data found in AI response');
          const result = await combatAI.processDMResponse(message, characterState.character);

          if (result.combatMessages && result.combatMessages.length > 0) {
            for (const m of result.combatMessages) {
              try {
                await sendMessage(m);
              } catch (e) {
                handleAsyncError(e, {
                  userMessage: 'Failed to send combat message',
                  logLevel: 'warn',
                  showToast: false,
                  context: { location: 'GameContent.onAIResponseWithCombat.sendCombatMessage' },
                });
              }
            }
          }
        }

        await handleAIResponse(message);
      } catch (error) {
        handleAsyncError(error, {
          userMessage: 'Failed to process AI response for combat',
          context: { location: 'GameContent.onAIResponseWithCombat' },
        });
      }
    },
    [combatAI, characterState, handleAIResponse, sendMessage],
  );

  React.useEffect(() => {
    if (prevInCombatRef.current && !combatState.isInCombat) {
      const enc = combatState.activeEncounter;
      const rounds = enc?.currentRound || enc?.roundsElapsed || 1;
      const participants = (enc?.participants || []).map((p: any) => ({
        name: p.name,
        damageDealt: (enc?.actions || [])
          .filter((a: any) => a.participantId === p.id && a.damageDealt)
          .reduce((s: number, a: any) => s + (a.damageDealt || 0), 0),
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
      lastSafetyCommand={lastSafetyCommand}
      contentWarnings={contentWarnings}
      comfortLevel={comfortLevel}
      showSafetyInfo={showSafetyInfo}
    />
  );
};

export default GameContent;
