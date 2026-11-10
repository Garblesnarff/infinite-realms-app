import React from 'react';

import { CampaignAssetsProvider } from '@/contexts/CampaignAssetsContext';
import { CombatProvider } from '@/contexts/CombatContext';
import { GameProvider } from '@/contexts/GameContext';
import { MemoryProvider } from '@/contexts/MemoryContext';
import { MessageProvider } from '@/contexts/MessageContext';
import { SceneBackgroundProvider } from '@/contexts/SceneBackgroundContext';
import { VoiceProvider } from '@/contexts/VoiceContext';
import { InspirationArmedProvider } from '@/features/game-session/contexts/inspiration-armed-context';
import { ErrorBoundary } from '@/shared/components/error/ErrorBoundary';
import { WebMcpCompanionBridge } from '@/webmcp/companion-tools';

interface GameProvidersProps {
  sessionId: string;
  starterCampaignId: string | null;
  characterId?: string | null;
  children: React.ReactNode;
}

/**
 * Wraps game content with all required context providers.
 * Flattens what was previously 7 levels of nesting into a single component.
 */
const GameProviders: React.FC<GameProvidersProps> = ({
  sessionId,
  starterCampaignId,
  characterId,
  children,
}) => (
  <ErrorBoundary level="feature">
    <CampaignAssetsProvider
      key={starterCampaignId || 'no-starter-campaign'}
      starterCampaignId={starterCampaignId}
    >
      <SceneBackgroundProvider>
        <CombatProvider sessionId={sessionId}>
          <GameProvider characterId={characterId}>
            <MessageProvider sessionId={sessionId}>
              <MemoryProvider sessionId={sessionId}>
                <VoiceProvider sessionId={sessionId}>
                  <InspirationArmedProvider>
                    <WebMcpCompanionBridge sessionId={sessionId} />
                    {children}
                  </InspirationArmedProvider>
                </VoiceProvider>
              </MemoryProvider>
            </MessageProvider>
          </GameProvider>
        </CombatProvider>
      </SceneBackgroundProvider>
    </CampaignAssetsProvider>
  </ErrorBoundary>
);

export default GameProviders;
