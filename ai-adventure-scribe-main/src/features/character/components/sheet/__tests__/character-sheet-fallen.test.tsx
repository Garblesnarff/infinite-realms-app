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

  it('#2517: keeps the hero pick disabled when the session lookup fails', async () => {
    mockFallenCharacter();
    // The route cannot be determined; a starter hero must not be sent to
    // the custom-campaign form by guessing.
    vi.mocked(userDataApi.listSessions).mockRejectedValue(new Error('network down'));

    render(<CharacterSheet />);

    expect(screen.getByTestId('death-screen')).toBeInTheDocument();
    // Let the failed lookup settle, then the button is still waiting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId('death-screen-new-character')).toBeDisabled();
    expect(navigate).not.toHaveBeenCalled();
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
