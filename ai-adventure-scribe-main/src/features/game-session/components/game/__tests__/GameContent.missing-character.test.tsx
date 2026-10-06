import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import GameContent from '../GameContent';

import { characterLoaderService } from '@/services/character-loader';
import { activeSessionId } from '@/services/client-failure-reporting';
import { userDataApi } from '@/services/user-data-api';

// Stable references: useGameData lists the dispatch functions as effect dependencies.
const stable = vi.hoisted(() => ({
  user: { id: 'user-1' },
  campaignValue: { state: { campaign: null }, dispatch: () => undefined },
  characterValue: { dispatch: () => undefined },
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

// The session hook is what the game needs a character for: it opens a session only when
// it is given one, exactly as use-session-initialization does.
vi.mock('@/hooks/use-game-session', () => ({
  useGameSession: (_campaignId: string, characterId?: string) =>
    characterId
      ? {
          sessionId: 'session-1',
          sessionData: { id: 'session-1', character_id: characterId },
          sessionState: 'active',
          updateGameSessionState: vi.fn(),
        }
      : {
          sessionId: null,
          sessionData: null,
          sessionState: 'idle',
          updateGameSessionState: vi.fn(),
        },
}));
vi.mock('@/hooks/use-local-storage', () => ({ useLocalStorage: () => [true, vi.fn()] }));
vi.mock('../game-content', () => ({
  GameLoadingOverlay: () => <div>Loading</div>,
  GameLayout: ({ characterIdForHandler }: { characterIdForHandler: string | null }) => (
    <div data-testid="game-open">hero:{characterIdForHandler}</div>
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
  useMessageContext: () => ({ messages: [], sendMessage: vi.fn(), messagesLoading: false }),
}));
vi.mock('@/features/game-session/hooks/use-deferred-combat-summary', () => ({
  useDeferredCombatSummary: vi.fn(),
}));
vi.mock('@/hooks/use-combat-ai-integration', () => ({
  useCombatAIIntegration: () => ({ isInCombat: false }),
}));
vi.mock('@/hooks/use-initial-greeting', () => ({
  useInitialGreeting: () => ({ isGenerating: false }),
}));
vi.mock('@/hooks/use-stale-client-check', () => ({ useStaleClientCheck: vi.fn() }));

const LocationProbe = (): JSX.Element => {
  const location = useLocation();
  return <div data-testid="url">{`${location.pathname}${location.search}`}</div>;
};

const renderRoute = (url: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <LocationProbe />
      <Routes>
        <Route path="/game/:id" element={<GameContent />} />
      </Routes>
    </MemoryRouter>,
  );

const campaign = { id: 'camp-1', name: 'Adventure', user_id: 'user-1' };

describe('GameContent without ?character', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (characterLoaderService.loadCharacterWithSpells as any).mockImplementation(
      async (id: string) => ({ id, name: 'Hero' }),
    );
    (userDataApi.getCampaign as any).mockResolvedValue(campaign);
    (userDataApi.listSessions as any).mockResolvedValue([]);
  });

  it('opens the game with the only hero and adds ?character to the URL', async () => {
    (userDataApi.listCharacters as any).mockResolvedValue([{ id: 'hero-1', name: 'Aldric' }]);

    renderRoute('/game/camp-1');

    expect(await screen.findByTestId('game-open')).toHaveTextContent('hero:hero-1');
    expect(screen.getByTestId('url')).toHaveTextContent('/game/camp-1?character=hero-1');
  });

  it('opens the game with the hero of the newest session when there are two', async () => {
    (userDataApi.listCharacters as any).mockResolvedValue([
      { id: 'hero-1', name: 'Aldric' },
      { id: 'hero-2', name: 'Mira' },
    ]);
    // listSessions returns newest first.
    (userDataApi.listSessions as any).mockResolvedValue([
      { id: 's-new', character_id: 'hero-2' },
      { id: 's-old', character_id: 'hero-1' },
    ]);

    renderRoute('/game/camp-1');

    expect(await screen.findByTestId('game-open')).toHaveTextContent('hero:hero-2');
    expect(screen.getByTestId('url')).toHaveTextContent('/game/camp-1?character=hero-2');
  });

  it('keeps other query parameters when it adds ?character', async () => {
    (userDataApi.listCharacters as any).mockResolvedValue([{ id: 'hero-1', name: 'Aldric' }]);

    renderRoute('/game/camp-1?session=s-9');

    await screen.findByTestId('game-open');
    expect(screen.getByTestId('url')).toHaveTextContent(
      '/game/camp-1?session=s-9&character=hero-1',
    );
  });

  it('shows a player-facing panel when the adventure has no hero', async () => {
    (userDataApi.listCharacters as any).mockResolvedValue([]);

    const { container } = renderRoute('/game/camp-1');

    expect(await screen.findByText('Pick your hero to continue')).toBeInTheDocument();
    expect(screen.getByText('This adventure has no hero yet on your account.')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Choose a hero' });
    expect(link).toHaveAttribute('href', '/app/campaigns/camp-1/characters');
    expect(container.textContent).not.toMatch(/URL parameters|Error:|Character ID/i);
    expect(screen.queryByTestId('game-open')).toBeNull();
  });

  it('shows "We could not find this adventure." for an unknown campaign', async () => {
    (userDataApi.getCampaign as any).mockRejectedValue(
      Object.assign(new Error('Not found (404)'), { status: 404 }),
    );

    const { container } = renderRoute('/game/missing');

    expect(await screen.findByText('We could not find this adventure.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Your adventures' })).toHaveAttribute('href', '/app');
    expect(container.textContent).not.toMatch(/URL parameters|Error:/i);
    expect(userDataApi.listCharacters).not.toHaveBeenCalled();
  });

  it('does not look anything up when ?character is present', async () => {
    renderRoute('/game/camp-1?character=hero-2');

    await waitFor(() => expect(screen.getByTestId('game-open')).toHaveTextContent('hero:hero-2'));
    expect(userDataApi.listCharacters).not.toHaveBeenCalled();
  });
});

// #2583: a game started from character selection has no ?session= in the URL, so the crash card
// and CLIENT_FAILURE name the session from the id GameContent publishes (the same setter #2589
// added). Leaving the game must clear it, or a crash on another page quotes this session.
describe('GameContent publishes the resolved session id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (characterLoaderService.loadCharacterWithSpells as any).mockImplementation(
      async (id: string) => ({ id, name: 'Hero' }),
    );
    (userDataApi.getCampaign as any).mockResolvedValue(campaign);
    (userDataApi.listSessions as any).mockResolvedValue([]);
  });

  it('publishes on resolve and clears on unmount', async () => {
    expect(activeSessionId()).toBeUndefined();

    const { unmount } = renderRoute('/game/camp-1?character=hero-2&new=true');

    await waitFor(() => expect(screen.getByTestId('game-open')).toBeInTheDocument());
    expect(activeSessionId()).toBe('session-1');

    unmount();
    expect(activeSessionId()).toBeUndefined();
  });
});
