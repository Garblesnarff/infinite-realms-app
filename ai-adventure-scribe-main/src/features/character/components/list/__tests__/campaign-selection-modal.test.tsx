import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import CampaignSelectionModal from '../campaign-selection-modal';

const mockNavigate = vi.fn();
const mockToast = vi.fn();
const mockCreateSession = vi.fn();
const mockListSessions = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), useNavigate: () => mockNavigate };
});

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createSession: (...args: unknown[]) => mockCreateSession(...args),
    listSessions: (...args: unknown[]) => mockListSessions(...args),
  },
}));

/** Mirror of the modal's own select: only active campaigns are offered. */
const mockAllCampaigns = [
  { id: 'camp-1', name: 'The Eternal Feast', description: 'A feast', status: 'active' },
  { id: 'camp-2', name: 'Archived Depths', description: 'Old', status: 'archived' },
];

vi.mock('@/features/campaign/hooks/use-campaigns-list', () => ({
  useCampaignsList: ({
    select,
  }: {
    select?: (c: typeof mockAllCampaigns) => typeof mockAllCampaigns;
  }) => ({
    data: select ? select(mockAllCampaigns) : mockAllCampaigns,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

const renderModal = (characterId: string): void => {
  render(<CampaignSelectionModal isOpen onClose={() => undefined} characterId={characterId} />);
};

describe('CampaignSelectionModal.handleStartSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'session-9' });
    mockListSessions.mockResolvedValue([]);
  });

  it('lists only active campaigns', () => {
    renderModal('char-1');
    expect(
      screen.getByRole('button', { name: 'Select campaign The Eternal Feast' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Select campaign Archived Depths' }),
    ).not.toBeInTheDocument();
  });

  it('creates the session for the exact character id (Hark RG-008: duplicate premades)', async () => {
    // RG-008: two copies of "The Scholar" exist in the account; the modal was
    // opened from char-scholar-2's card. Starting the session must bind the
    // session to that exact id — never resolve by name to the other copy.
    renderModal('char-scholar-2');

    fireEvent.click(screen.getByRole('button', { name: 'Select campaign The Eternal Feast' }));

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateSession).toHaveBeenCalledWith({
      campaign_id: 'camp-1',
      character_id: 'char-scholar-2',
      status: 'active',
    });
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Session Started' }));
    expect(mockNavigate).toHaveBeenCalledWith(
      '/app/campaigns/camp-1?session=session-9&character=char-scholar-2',
    );
  });

  it('shows a destructive toast and does not navigate when session creation fails', async () => {
    mockCreateSession.mockRejectedValue(new Error('nope'));
    renderModal('char-1');

    fireEvent.click(screen.getByRole('button', { name: 'Select campaign The Eternal Feast' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', variant: 'destructive' }),
      );
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

/** #1355: the modal is the custom hero's Play path (premade Play-as lives on
 *  CampaignDetailPage). Rows follow the SessionListApiRow fields the modal
 *  reads: id, status, session_number, starter_campaign_id. */
const sessionRow = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  id: 'session-1',
  campaign_id: 'camp-1',
  character_id: 'char-tessa',
  session_number: 1,
  status: 'completed',
  starter_campaign_id: null,
  updated_at: '2026-11-03T10:00:00Z',
  ...overrides,
});

const clickFeast = (): void => {
  fireEvent.click(screen.getByRole('button', { name: 'Select campaign The Eternal Feast' }));
};

describe('CampaignSelectionModal.handleStartSession #1355 custom hero continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'session-9' });
    mockListSessions.mockResolvedValue([]);
  });

  it('continues a completed playthrough through the game route instead of creating a fresh session 1', async () => {
    // Hark T3-004: Tessa Ironhold (custom, wizard-made) ended session 1 in
    // The Last Bout; Play then started a brand-new session 1 with a fresh
    // opening and no "Rest first?". The game route creates the N+1
    // continuation itself — the same path premade Play-as uses — so the
    // modal only navigates, never creates here.
    mockListSessions.mockResolvedValue([sessionRow({})]);
    renderModal('char-tessa');

    clickFeast();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/app/game/camp-1?character=char-tessa');
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockListSessions).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      characterId: 'char-tessa',
      limit: 100,
      offset: 0,
    });
  });

  it('carries the chain starter link from the latest completed row', async () => {
    mockListSessions.mockResolvedValue([
      sessionRow({ id: 'session-1', session_number: 1, starter_campaign_id: 'starter-old' }),
      sessionRow({ id: 'session-2', session_number: 2, starter_campaign_id: 'starter-last-bout' }),
    ]);
    renderModal('char-tessa');

    clickFeast();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-tessa&starterCampaign=starter-last-bout',
      );
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('resumes an active session exactly instead of creating (creating would retire it server-side)', async () => {
    mockListSessions.mockResolvedValue([
      sessionRow({ id: 'session-live', session_number: 2, status: 'active' }),
      sessionRow({ id: 'session-1', session_number: 1 }),
    ]);
    renderModal('char-tessa');

    clickFeast();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-tessa&session=session-live',
      );
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('fails closed on a session-list error: no create, no navigate', async () => {
    mockListSessions.mockRejectedValue(new Error('list down'));
    renderModal('char-tessa');

    clickFeast();

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', variant: 'destructive' }),
      );
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('pages past 100 rows and takes the starter link from the latest row on page 2', async () => {
    // Self-review nit: pin the offset/short-page loop. Page 1 is exactly
    // full (100 rows), so the modal must fetch page 2 before deciding.
    mockListSessions.mockImplementation(({ offset }: { offset?: number }) => {
      if (offset === 0) {
        return Promise.resolve(
          Array.from({ length: 100 }, (_, i) =>
            sessionRow({ id: `session-p1-${i}`, session_number: i + 1 }),
          ),
        );
      }
      return Promise.resolve([
        sessionRow({
          id: 'session-p2',
          session_number: 101,
          starter_campaign_id: 'starter-page-2',
        }),
      ]);
    });
    renderModal('char-tessa');

    clickFeast();

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-tessa&starterCampaign=starter-page-2',
      );
    });
    expect(mockCreateSession).not.toHaveBeenCalled();
    expect(mockListSessions).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      characterId: 'char-tessa',
      limit: 100,
      offset: 100,
    });
  });
});
