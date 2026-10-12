import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import CampaignSelectionModal from '../campaign-selection-modal';

const mockNavigate = vi.fn();
const mockToast = vi.fn();
const mockCreateSession = vi.fn();

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
  },
}));

/** Mirror of the modal's own select: only active campaigns are offered. */
const mockAllCampaigns = [
  { id: 'camp-1', name: 'The Eternal Feast', description: 'A feast', status: 'active' },
  { id: 'camp-2', name: 'Archived Depths', description: 'Old', status: 'archived' },
];

vi.mock('@/features/campaign/hooks/use-campaigns-list', () => ({
  useCampaignsList: ({ select }: { select?: (c: typeof mockAllCampaigns) => typeof mockAllCampaigns }) => ({
    data: select ? select(mockAllCampaigns) : mockAllCampaigns,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

const renderModal = (characterId: string): void => {
  render(
    <CampaignSelectionModal isOpen onClose={() => undefined} characterId={characterId} />,
  );
};

describe('CampaignSelectionModal.handleStartSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSession.mockResolvedValue({ id: 'session-9' });
  });

  it('lists only active campaigns', () => {
    renderModal('char-1');
    expect(screen.getByRole('button', { name: 'Select campaign The Eternal Feast' })).toBeInTheDocument();
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
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Session Started' }),
    );
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
