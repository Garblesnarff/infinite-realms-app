/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2517: opening a fallen character shows the end state, read-only — not
 * the editable sheet. The truth is `character_stats.vital_state`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CharacterSheet from '../character-sheet';

import { useCharacterData } from '@/hooks/use-character-data';
import { useStarterCampaigns } from '@/hooks/use-starter-campaigns';
import { userDataApi } from '@/services/user-data-api';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useParams: () => ({ id: 'char-1' }),
  useNavigate: () => navigate,
}));
vi.mock('@/hooks/use-character-data', () => ({ useCharacterData: vi.fn() }));
vi.mock('../character-sheet-tabs', () => ({ default: () => <div data-testid="sheet-tabs" /> }));
vi.mock('@/hooks/use-starter-campaigns', () => ({ useStarterCampaigns: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listSessions: vi.fn() },
}));

const baseCharacter = {
  id: 'char-1',
  name: 'The Scholar',
  campaign_id: 'camp-1',
  level: 1,
};

const mockFallenCharacter = (): void => {
  vi.mocked(useCharacterData).mockReturnValue({
    character: {
      ...baseCharacter,
      character_stats: { vital_state: 'dead', current_hit_points: 0, max_hit_points: 7 },
    },
    unresolvedData: [],
    equipmentUnavailable: false,
    loading: false,
    refetch: vi.fn(),
  } as any);
};

describe('CharacterSheet fallen (#2517)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useStarterCampaigns).mockReturnValue({
      campaigns: [],
      featuredCampaigns: [],
      isLoading: false,
      error: null,
    } as any);
    vi.mocked(userDataApi.listSessions).mockResolvedValue([] as any);
  });

  it('shows the end state for a fallen character instead of the sheet', async () => {
    mockFallenCharacter();

    render(<CharacterSheet />);

    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    expect(screen.getByText('The Scholar has fallen')).toBeInTheDocument();
    expect(screen.queryByTestId('sheet-tabs')).not.toBeInTheDocument();

    // The hero pick routes into this character's campaign, never bare create.
    // The button waits for the starter resolution before it can be clicked.
    const chooseHero = screen.getByTestId('death-screen-new-character');
    await waitFor(() => {
      expect(chooseHero).not.toBeDisabled();
    });
    fireEvent.click(chooseHero);
    expect(navigate).toHaveBeenCalledWith('/app/characters/create?campaign=camp-1');
  });

  it('#2517: routes a fallen starter-campaign hero back through its hero pick', async () => {
    mockFallenCharacter();
    // The dead run's session carries the starter id; the list resolves the
    // slug and name — the same resolution the game screen performs.
    vi.mocked(userDataApi.listSessions).mockResolvedValue([
      { id: 'sess-dead', status: 'completed', starter_campaign_id: 'starter-1' },
    ] as any);
    vi.mocked(useStarterCampaigns).mockReturnValue({
      campaigns: [{ id: 'starter-1', slug: 'abyssal-descent', title: 'Abyssal Descent' }],
      featuredCampaigns: [],
      isLoading: false,
      error: null,
    } as any);

    render(<CharacterSheet />);

    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    const chooseHero = screen.getByTestId('death-screen-new-character');
    await waitFor(() => {
      expect(chooseHero).not.toBeDisabled();
    });
    expect(screen.getByText(/Begin Abyssal Descent again with a new hero/)).toBeInTheDocument();
    fireEvent.click(chooseHero);
    expect(navigate).toHaveBeenCalledWith(
      '/explore/abyssal-descent/choose-character?campaignId=camp-1',
    );
  });

  it('#1215: hides the hero pick (never a disabled offer) when the session lookup keeps failing', async () => {
    mockFallenCharacter();
    // #2517 kept the button disabled here, under text that offers it (Hark
    // T3-010). The route still cannot be guessed -- a starter hero must not
    // be sent to the custom-campaign form -- so after one retry the offer is
    // hidden; Explore and Back to your realm stay.
    vi.mocked(userDataApi.listSessions).mockRejectedValue(new Error('network down'));

    render(<CharacterSheet />);

    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    await waitFor(
      () => {
        expect(screen.queryByTestId('death-screen-new-character')).not.toBeInTheDocument();
      },
      { timeout: 4000 },
    );
    expect(userDataApi.listSessions).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/again with a new hero/)).not.toBeInTheDocument();
    expect(screen.getByTestId('death-screen-explore')).toBeEnabled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('#1215: a lookup that fails once and then answers enables the hero pick', async () => {
    mockFallenCharacter();
    vi.mocked(userDataApi.listSessions)
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce([
        { id: 'sess-dead', status: 'completed', campaign_id: 'camp-1', starter_campaign_id: null },
      ] as any);

    render(<CharacterSheet />);

    await waitFor(
      () => {
        expect(screen.getByTestId('death-screen-new-character')).toBeEnabled();
      },
      { timeout: 4000 },
    );
    fireEvent.click(screen.getByTestId('death-screen-new-character'));
    expect(navigate).toHaveBeenCalledWith('/app/characters/create?campaign=camp-1');
  });

  it('#1215 roster path: the sheet character carries no campaign_id; the hero pick takes the campaign from the dead run', async () => {
    // The shape useCharacterData really returns: transformCharacterData keeps
    // no campaign_id. The dead run's session carries both the campaign and
    // the starter link.
    vi.mocked(useCharacterData).mockReturnValue({
      character: {
        id: 'char-1',
        name: 'Clarice Faro',
        level: 3,
        character_stats: { vital_state: 'dead', current_hit_points: 0, max_hit_points: 23 },
      },
      unresolvedData: [],
      equipmentUnavailable: false,
      loading: false,
      refetch: vi.fn(),
    } as any);
    vi.mocked(userDataApi.listSessions).mockResolvedValue([
      {
        id: 'sess-dead',
        status: 'completed',
        campaign_id: 'camp-gh',
        starter_campaign_id: 'starter-gh',
      },
    ] as any);
    vi.mocked(useStarterCampaigns).mockReturnValue({
      campaigns: [{ id: 'starter-gh', slug: 'the-gardeners-heir', title: "The Gardener's Heir" }],
      featuredCampaigns: [],
      isLoading: false,
      error: null,
    } as any);

    render(<CharacterSheet />);

    const chooseHero = screen.getByTestId('death-screen-new-character');
    await waitFor(() => {
      expect(chooseHero).toBeEnabled();
    });
    expect(userDataApi.listSessions).toHaveBeenCalledWith({
      campaignId: undefined,
      characterId: 'char-1',
      limit: 5,
    });
    expect(screen.getByText(/Begin The Gardener's Heir again with a new hero/)).toBeInTheDocument();
    fireEvent.click(chooseHero);
    expect(navigate).toHaveBeenCalledWith(
      '/explore/the-gardeners-heir/choose-character?campaignId=camp-gh',
    );
  });

  it('#1215: a fallen hero with no campaign at all gets no hero-pick offer', async () => {
    vi.mocked(useCharacterData).mockReturnValue({
      character: {
        id: 'char-1',
        name: 'Nobody Special',
        level: 1,
        character_stats: { vital_state: 'dead', current_hit_points: 0, max_hit_points: 8 },
      },
      unresolvedData: [],
      equipmentUnavailable: false,
      loading: false,
      refetch: vi.fn(),
    } as any);
    vi.mocked(userDataApi.listSessions).mockResolvedValue([] as any);

    render(<CharacterSheet />);

    await waitFor(() => {
      expect(screen.queryByTestId('death-screen-new-character')).not.toBeInTheDocument();
    });
    expect(screen.queryByText(/again with a new hero/)).not.toBeInTheDocument();
    expect(screen.getByTestId('death-screen-explore')).toBeInTheDocument();
  });

  it('shows the editable sheet for a living character', () => {
    vi.mocked(useCharacterData).mockReturnValue({
      character: {
        ...baseCharacter,
        character_stats: { vital_state: 'standing', current_hit_points: 7, max_hit_points: 7 },
      },
      unresolvedData: [],
      equipmentUnavailable: false,
      loading: false,
      refetch: vi.fn(),
    } as any);

    render(<CharacterSheet />);

    expect(screen.getByTestId('sheet-tabs')).toBeInTheDocument();
    expect(screen.queryByTestId('death-screen')).not.toBeInTheDocument();
  });
});
