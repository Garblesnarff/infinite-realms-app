/**
 * #1703 Part A: clicking End session in a live game completes the session, navigates to the
 * hero's game URL with no continue flag, and lands the player on EndedSessionChoice showing
 * both "Start new session" and "Resume session" without creating a second session.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EndSessionButton } from '../game-content/EndSessionButton';
import GameContent from '../GameContent';

import { characterLoaderService } from '@/services/character-loader';
import { userDataApi } from '@/services/user-data-api';

type FakeSessionRow = {
  id: string;
  campaign_id: string;
  character_id: string;
  session_number: number;
  status: 'active' | 'completed';
  start_time: string;
  end_time: string | null;
  current_scene_description: string;
  summary: string | null;
  turn_count: number;
  starter_campaign_id: string | null;
};

const store = vi.hoisted(() => ({
  user: { id: 'user-1' },
  campaignValue: { state: { campaign: null }, dispatch: () => undefined },
  characterValue: { state: { character: null }, dispatch: () => undefined },
  messageContextState: { isLoading: false, messages: [], sendMessage: vi.fn() },
  sessions: [] as FakeSessionRow[],
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/contexts/CampaignContext', () => ({ useCampaign: () => store.campaignValue }));
vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: () => store.characterValue }));
vi.mock('@/services/character-loader', () => ({
  characterLoaderService: {
    loadCharacterWithSpells: vi.fn(),
  },
}));
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({ campaigns: [], isLoading: false }),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    listCharacters: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    completeSession: vi.fn(),
    listResumableSessions: vi.fn(),
    createSession: vi.fn(),
    resumeSession: vi.fn(),
    reportClientFailure: vi.fn(),
    fetchSessionFallenState: vi.fn(async () => null),
    fetchSessionCompletionState: vi.fn(async () => null),
  },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));
vi.mock('@/hooks/use-local-storage', () => ({ useLocalStorage: () => [true, vi.fn()] }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

// Mount the real EndSessionButton inside the game layout stub with the exact props GameLayout passes.
vi.mock('../game-content', () => ({
  GameLoadingOverlay: () => <div>Loading</div>,
  GameLayout: ({
    sessionId,
    campaignIdForHandler,
    characterIdForHandler,
    sessionData,
  }: {
    sessionId: string;
    campaignIdForHandler: string | null;
    characterIdForHandler: string | null;
    sessionData: { character_id?: string | null; starter_campaign_id?: string | null };
  }) => (
    <div data-testid="game-layout">
      <EndSessionButton
        sessionId={sessionId}
        campaignId={campaignIdForHandler}
        characterId={characterIdForHandler ?? sessionData.character_id ?? null}
        starterCampaignId={sessionData.starter_campaign_id ?? null}
      />
    </div>
  ),
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
  useMessageContext: () => store.messageContextState,
}));
vi.mock('@/hooks/use-initial-greeting', () => ({
  useInitialGreeting: () => ({ isGenerating: false, timedOut: false, retry: vi.fn() }),
}));
vi.mock('@/features/game-session/hooks/use-deferred-combat-summary', () => ({
  useDeferredCombatSummary: vi.fn(),
}));
vi.mock('@/hooks/use-combat-ai-integration', () => ({
  useCombatAIIntegration: () => ({ isInCombat: false }),
}));
vi.mock('@/hooks/use-stale-client-check', () => ({ useStaleClientCheck: vi.fn() }));

describe('End session lands on the two choices (#1703)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.sessions = [
      {
        id: 'sess-1',
        campaign_id: 'camp-1',
        character_id: 'hero-1',
        session_number: 1,
        status: 'active',
        start_time: new Date().toISOString(),
        end_time: null,
        current_scene_description: 'The bell tower of Oakhaven.',
        summary: null,
        turn_count: 4,
        starter_campaign_id: 'starter-1',
      },
    ];

    vi.mocked(characterLoaderService.loadCharacterWithSpells).mockResolvedValue({
      id: 'hero-1',
      name: 'Alden',
    } as never);
    vi.mocked(userDataApi.getCampaign).mockResolvedValue({
      id: 'camp-1',
      name: 'Oakhaven',
      user_id: 'user-1',
    });
    vi.mocked(userDataApi.listSessions).mockImplementation(async () => [...store.sessions]);
    vi.mocked(userDataApi.getSession).mockImplementation(async (id: string) => {
      const found = store.sessions.find((s) => s.id === id);
      if (!found) throw new Error('Not found');
      return found;
    });
    vi.mocked(userDataApi.completeSession).mockImplementation(async (id: string) => {
      const found = store.sessions.find((s) => s.id === id);
      if (found) {
        found.status = 'completed';
        found.end_time = new Date().toISOString();
      }
      return found;
    });
    vi.mocked(userDataApi.listResumableSessions).mockImplementation(async () =>
      store.sessions.filter((s) => s.status === 'completed'),
    );
  });

  it('clicking End session from the hero game URL shows Start new session and Resume session', async () => {
    render(
      <MemoryRouter
        initialEntries={['/app/game/camp-1?character=hero-1&starterCampaign=starter-1']}
      >
        <Routes>
          <Route path="/app/game/:id" element={<GameContent />} />
        </Routes>
      </MemoryRouter>,
    );

    const endButton = await screen.findByRole('button', { name: 'End session' });
    fireEvent.click(endButton);

    expect(
      await screen.findByRole('heading', { name: 'Choose how to continue' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start new session' })).toBeEnabled();
    const resumeButton = screen.getByRole('button', { name: 'Resume session' });
    await waitFor(() => expect(resumeButton).toBeEnabled());

    expect(userDataApi.completeSession).toHaveBeenCalledWith('sess-1');
    expect(userDataApi.createSession).not.toHaveBeenCalled();
  });

  it('clicking End session from a ?session= URL also lands on the two choices', async () => {
    render(
      <MemoryRouter initialEntries={['/app/game/camp-1?character=hero-1&session=sess-1']}>
        <Routes>
          <Route path="/app/game/:id" element={<GameContent />} />
        </Routes>
      </MemoryRouter>,
    );

    const endButton = await screen.findByRole('button', { name: 'End session' });
    fireEvent.click(endButton);

    expect(
      await screen.findByRole('heading', { name: 'Choose how to continue' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start new session' })).toBeEnabled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Resume session' })).toBeEnabled(),
    );
    expect(userDataApi.createSession).not.toHaveBeenCalled();
  });
});
