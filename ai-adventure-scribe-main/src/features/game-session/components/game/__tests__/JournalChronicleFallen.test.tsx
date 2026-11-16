import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StorySoFarLink } from '../StorySoFarLink';

import type * as ReactRouterDOM from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDOM>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ userPlan: 'pro' }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({ campaigns: [], isLoading: false }),
}));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { completeSession: vi.fn() } }));
vi.mock('@/infrastructure/api', () => ({
  trpc: {
    chronicles: {
      getBySessionId: { useQuery: vi.fn() },
      generate: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
      },
    },
    useUtils: vi.fn(() => ({ chronicles: { getBySessionId: { invalidate: vi.fn() } } })),
  },
}));

import { trpc } from '@/infrastructure/api';

describe('Journal chronicle fallen hero (#1557)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue({ data: null } as never);
  });

  it('does not show End session when opened from Journal with isFallen', () => {
    const endSession = { campaignId: 'campaign-1', starterCampaignId: null };
    render(
      <MemoryRouter>
        <StorySoFarLink sessionId="game-1" endSession={endSession} isFallen />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Read the chronicle/ }));
    expect(
      screen.getByText('Your chronicle is written when you end the session.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End session' })).toBeNull();
  });

  it('still shows End session for a living hero on the Journal path', () => {
    const endSession = { campaignId: 'campaign-1', starterCampaignId: null };
    render(
      <MemoryRouter>
        <StorySoFarLink sessionId="game-1" endSession={endSession} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Read the chronicle/ }));
    expect(screen.getByRole('button', { name: 'End session' })).toBeInTheDocument();
  });
});
