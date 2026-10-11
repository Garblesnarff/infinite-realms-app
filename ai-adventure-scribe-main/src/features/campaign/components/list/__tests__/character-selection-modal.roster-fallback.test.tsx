/**
 * #2142: a campaign with no bound characters must not hide the account roster,
 * and "Create" must reach character creation with the campaign preselected.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CharacterSelectionModal from '../character-selection-modal';

import type { Character, StarterTemplate } from '@/features/campaign/hooks/use-character-selection';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessions: vi.fn(),
    listStarterCharacterTemplates: vi.fn(),
    listCharacters: vi.fn(),
    createCharacter: vi.fn(),
  },
}));

const api = userDataApi as unknown as {
  listSessions: ReturnType<typeof vi.fn>;
  listStarterCharacterTemplates: ReturnType<typeof vi.fn>;
  listCharacters: ReturnType<typeof vi.fn>;
};

const CAMPAIGN_ID = 'camp-whisperwood';

const makeCharacter = (i: number): Character => ({
  id: `char-${i}`,
  name: `Hero ${i}`,
  race: 'Human',
  class: 'Fighter',
  level: 1,
});

const makeTemplate = (): StarterTemplate => ({
  id: 'tpl-1',
  starter_campaign_id: 'starter-1',
  template_key: 'scholar',
  name: 'The Scholar',
  tagline: null,
  race: 'Human',
  subrace: null,
  class: 'Wizard',
  background: null,
  level: 1,
  ability_scores: {
    strength: 8,
    dexterity: 12,
    constitution: 12,
    intelligence: 16,
    wisdom: 14,
    charisma: 10,
  },
  personality: {},
  skills: [],
  languages: [],
  equipment: [],
  adapted_backstory: null,
  campaign_hook: null,
  portrait_url: null,
  card_image_url: null,
  portrait_prompt: null,
  display_order: 0,
});

/** Mirrors CampaignHub: the modal is driven by ?startSession, and onClose rewrites the URL. */
const HubWithModal: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOpen = new URLSearchParams(location.search).get('startSession') === 'true';
  return (
    <CharacterSelectionModal
      isOpen={isOpen}
      onClose={() => navigate({ pathname: location.pathname, search: '' }, { replace: true })}
      campaignId={CAMPAIGN_ID}
      campaignName="Whisperwood"
    />
  );
};

const CreatePage: React.FC = () => {
  const location = useLocation();
  return <div data-testid="create-page">{location.search}</div>;
};

const GamePage: React.FC = () => {
  const location = useLocation();
  return <div data-testid="game-page">{location.pathname + location.search}</div>;
};

function renderPicker(): ReturnType<typeof render> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/campaigns/${CAMPAIGN_ID}?startSession=true`]}>
        <Routes>
          <Route path="/app/campaigns/:id" element={<HubWithModal />} />
          <Route path="/app/characters/create" element={<CreatePage />} />
          <Route path="/app/game/:id" element={<GamePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CharacterSelectionModal — empty campaign falls back to the account roster (#2142)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listSessions.mockResolvedValue([]);
    api.listStarterCharacterTemplates.mockResolvedValue([]);
  });

  it('shows the whole account roster with "Use here" when no character is bound to the campaign', async () => {
    const roster = Array.from({ length: 20 }, (_, i) => makeCharacter(i + 1));
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [] : roster,
    );

    renderPicker();

    expect(await screen.findAllByRole('button', { name: /Select character: Hero/ })).toHaveLength(
      20,
    );
    expect(screen.getAllByText('Use here')).toHaveLength(20);
    expect(screen.queryByText("You don't have any characters yet.")).not.toBeInTheDocument();
    expect(api.listCharacters).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(api.listCharacters).toHaveBeenCalledWith();
  });

  it('"Use here" starts the game in this campaign with the chosen character', async () => {
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [] : [makeCharacter(7)],
    );

    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: /Select character: Hero 7/ }));

    await waitFor(() =>
      expect(screen.getByTestId('game-page')).toHaveTextContent(
        `/app/game/${CAMPAIGN_ID}?character=char-7&new=true`,
      ),
    );
  });

  it('does not fetch the account roster while the campaign has bound characters', async () => {
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [makeCharacter(1)] : [makeCharacter(1), makeCharacter(2)],
    );

    renderPicker();

    expect(await screen.findByText('Start Adventure')).toBeInTheDocument();
    expect(screen.queryByText('Use here')).not.toBeInTheDocument();
    expect(api.listCharacters).toHaveBeenCalledTimes(1);
    expect(api.listCharacters).toHaveBeenCalledWith(CAMPAIGN_ID);
  });

  it('"Create" goes to character creation with this campaign preselected', async () => {
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [] : [makeCharacter(1)],
    );

    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: /Create a New Character/ }));

    await waitFor(() =>
      expect(screen.getByTestId('create-page')).toHaveTextContent(`?campaign=${CAMPAIGN_ID}`),
    );
  });

  it('shows the create-only state when the account has no characters, and Create navigates', async () => {
    api.listCharacters.mockResolvedValue([]);

    renderPicker();

    expect(await screen.findByText("You don't have any characters yet.")).toBeInTheDocument();
    expect(screen.queryByText('Use here')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create Your First Character/ }));

    await waitFor(() =>
      expect(screen.getByTestId('create-page')).toHaveTextContent(`?campaign=${CAMPAIGN_ID}`),
    );
  });

  it('shows retry, not "no characters", when the account roster fails to load', async () => {
    let rosterCalls = 0;
    api.listCharacters.mockImplementation(async (campaignId?: string) => {
      if (campaignId) return [];
      rosterCalls += 1;
      if (rosterCalls === 1) throw new Error('network down');
      return [makeCharacter(3)];
    });

    renderPicker();

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load characters');
    expect(screen.queryByText("You don't have any characters yet.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Use here')).toBeInTheDocument();
  });

  it('a starter campaign with no templates shows the load failure, not the roster or Create', async () => {
    api.listSessions.mockResolvedValue([{ starter_campaign_id: 'starter-1' }]);
    // The account HAS characters, so the roster is fetched — but a starter must
    // not offer it: empty templates means the template load failed (#2193 review).
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [] : [makeCharacter(4)],
    );

    renderPicker();

    expect(
      await screen.findByText('No character templates available for this campaign.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Use here')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
    expect(api.listStarterCharacterTemplates).toHaveBeenCalledWith('starter-1');
  });

  it('a starter campaign with loaded templates also offers the account roster (#321)', async () => {
    api.listSessions.mockResolvedValue([{ starter_campaign_id: 'starter-1' }]);
    api.listStarterCharacterTemplates.mockResolvedValue([makeTemplate()]);
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [] : [makeCharacter(9)],
    );

    renderPicker();

    // The premade template is still offered…
    expect(
      await screen.findByRole('button', { name: /Select character: The Scholar/ }),
    ).toBeInTheDocument();
    // …and the saved custom character is offered below it, not hidden.
    expect(
      await screen.findByRole('button', { name: /Select character: Hero 9/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('Your characters')).toBeInTheDocument();
    expect(screen.getAllByText('Use here')).toHaveLength(1);
  });

  it('picking a custom character on a starter campaign keeps the starter link (#321)', async () => {
    api.listSessions.mockResolvedValue([{ starter_campaign_id: 'starter-1' }]);
    api.listStarterCharacterTemplates.mockResolvedValue([makeTemplate()]);
    api.listCharacters.mockImplementation(async (campaignId?: string) =>
      campaignId ? [] : [makeCharacter(9)],
    );

    renderPicker();
    fireEvent.click(await screen.findByRole('button', { name: /Select character: Hero 9/ }));

    // Same session plumbing as a premade pick: the starter id rides along so
    // the session keeps starter_campaign_id (DM lore, difficulty, hero flow).
    await waitFor(() =>
      expect(screen.getByTestId('game-page')).toHaveTextContent(
        `/app/game/${CAMPAIGN_ID}?character=char-9&starterCampaign=starter-1&new=true`,
      ),
    );
  });

  it('a failed roster load on a starter campaign shows an inline retry, not a full-modal error (#321)', async () => {
    api.listSessions.mockResolvedValue([{ starter_campaign_id: 'starter-1' }]);
    api.listStarterCharacterTemplates.mockResolvedValue([makeTemplate()]);
    let rosterCalls = 0;
    api.listCharacters.mockImplementation(async (campaignId?: string) => {
      if (campaignId) return [];
      rosterCalls += 1;
      if (rosterCalls === 1) throw new Error('network down');
      return [makeCharacter(5)];
    });

    renderPicker();

    // The templates still render — a roster failure must not hide them.
    expect(
      await screen.findByRole('button', { name: /Select character: The Scholar/ }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Couldn't load your characters/)).toBeInTheDocument();
    expect(screen.queryByText('Use here')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Use here')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load your characters/)).not.toBeInTheDocument();
  });
});
