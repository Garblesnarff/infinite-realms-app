import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import GameContent from '../GameContent';

import { useDeferredCombatSummary } from '@/features/game-session/hooks/use-deferred-combat-summary';
import { useInitialGreeting } from '@/hooks/use-initial-greeting';
import { characterLoaderService } from '@/services/character-loader';
import { userDataApi } from '@/services/user-data-api';

const stable = vi.hoisted(() => ({
  user: { id: 'user-1' },
  campaignValue: { state: { campaign: null }, dispatch: () => undefined },
  characterValue: { dispatch: () => undefined },
  messageContextState: { isLoading: true, messages: [], sendMessage: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: stable.user }) }));
vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => stable.campaignValue }));
vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: () => stable.characterValue }));
vi.mock('@/services/character-loader', () => ({
  characterLoaderService: {
    loadCharacterWithSpells: vi.fn(),
  },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    listCharacters: vi.fn(),
    listSessions: vi.fn(),
    reportClientFailure: vi.fn(),
  },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

vi.mock('@/hooks/use-game-session', () => ({
  useGameSession: (_campaignId: string, characterId?: string) => ({
    sessionId: 'session-1',
    sessionData: { id: 'session-1', character_id: characterId, turn_count: 0 },
    sessionState: 'active',
    updateGameSessionState: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-local-storage', () => ({ useLocalStorage: () => [true, vi.fn()] }));
vi.mock('../game-content', () => ({
  GameLoadingOverlay: () => <div>Loading</div>,
  GameLayout: () => <div data-testid="game-layout">Game Layout</div>,
}));
vi.mock('../game-content/use-game-rails', () => ({
  useGameRails: () => ({
    isLeftCollapsed: false,
    isRightCollapsed: false,
    setIsLeftCollapsed: vi.fn(),
    setIsRightCollapsed: vi.fn(),
  }),
}));
vi.mock('../GameProviders', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { isInCombat: false, activeEncounter: null } }),
}));
vi.mock('@/contexts/MemoryContext', () => ({
  useMemoryContext: () => ({ createMemory: vi.fn() }),
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => stable.messageContextState,
}));

vi.mock('@/hooks/use-initial-greeting', () => ({
  useInitialGreeting: vi.fn(() => ({ isGenerating: false })),
}));

vi.mock('@/features/game-session/hooks/use-deferred-combat-summary', () => ({
  useDeferredCombatSummary: vi.fn(),
}));

vi.mock('@/hooks/use-combat-ai-integration', () => ({
  useCombatAIIntegration: () => ({ isInCombat: false }),
}));
vi.mock('@/hooks/use-stale-client-check', () => ({ useStaleClientCheck: vi.fn() }));

const campaign = { id: 'camp-1', name: 'Adventure', user_id: 'user-1' };

const renderGame = () =>
  render(
    <MemoryRouter initialEntries={['/game/camp-1?character=hero-1']}>
      <Routes>
        <Route path="/game/:id" element={<GameContent />} />
      </Routes>
    </MemoryRouter>,
  );

describe('GameContent message loading integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({
      id: 'hero-1',
      name: 'Hero',
    });
    (userDataApi.getCampaign as any).mockResolvedValue(campaign);
  });

  it('passes real isLoading state from useMessageContext to useInitialGreeting and useDeferredCombatSummary', async () => {
    stable.messageContextState.isLoading = true;

    const { rerender } = renderGame();

    await vi.waitFor(() => {
      expect(useInitialGreeting).toHaveBeenCalled();
      expect(useDeferredCombatSummary).toHaveBeenCalled();
    });

    const lastGreetingCallIndex = (useInitialGreeting as any).mock.calls.length - 1;
    const initialGreetingArgs = (useInitialGreeting as any).mock.calls[lastGreetingCallIndex][0];
    const deferredCombatSummaryArgs = (useDeferredCombatSummary as any).mock.calls[
      (useDeferredCombatSummary as any).mock.calls.length - 1
    ][0];

    expect(initialGreetingArgs.messagesLoading).toBe(true);
    expect(deferredCombatSummaryArgs.messagesLoading).toBe(true);

    stable.messageContextState.isLoading = false;
    rerender(
      <MemoryRouter initialEntries={['/game/camp-1?character=hero-1']}>
        <Routes>
          <Route path="/game/:id" element={<GameContent />} />
        </Routes>
      </MemoryRouter>,
    );

    await vi.waitFor(() => {
      const latestGreetingArgs = (useInitialGreeting as any).mock.calls[
        (useInitialGreeting as any).mock.calls.length - 1
      ][0];
      const latestSummaryArgs = (useDeferredCombatSummary as any).mock.calls[
        (useDeferredCombatSummary as any).mock.calls.length - 1
      ][0];
      expect(latestGreetingArgs.messagesLoading).toBe(false);
      expect(latestSummaryArgs.messagesLoading).toBe(false);
    });
  });
});
