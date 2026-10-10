import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CampaignOverview from '../CampaignOverview';

const state = vi.hoisted(() => ({
  activeSessions: [] as Array<{
    id: string;
    character_id: string | null;
    start_time: string;
    created_at: string;
  }>,
  navigatedTo: null as string | null,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.activeSessions, isLoading: false }),
}));

import type * as ReactRouterDom from 'react-router-dom';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouterDom>();
  return {
    ...actual,
    useNavigate: () => (to: string) => {
      state.navigatedTo = to;
    },
  };
});

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ userPlan: 'free' }) }));
vi.mock('@/services/user-data-api', () => ({ userDataApi: {} }));

function renderOverview(): void {
  render(
    <MemoryRouter initialEntries={['/app/campaigns/camp-1']}>
      <Routes>
        <Route
          path="/app/campaigns/:id"
          element={<CampaignOverview campaign={{ id: 'camp-1', description: 'A test campaign' }} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

// GP-024: the campaign card's Resume Session button must take the player
// straight into the game, not land them on the Sessions tab for a second click.
describe('CampaignOverview resume (GP-024)', () => {
  beforeEach(() => {
    state.activeSessions = [];
    state.navigatedTo = null;
  });

  it('navigates directly to the game for the most recent resumable session', () => {
    // Relative dates: free-tier sessions expire after 7 days, so hardcoded
    // dates would turn this into a time bomb.
    const older = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    state.activeSessions = [
      { id: 'sess-old', character_id: 'char-1', start_time: older, created_at: older },
      { id: 'sess-new', character_id: 'char-2', start_time: newer, created_at: newer },
    ];
    renderOverview();

    fireEvent.click(screen.getByText('Resume Session'));

    expect(state.navigatedTo).toBe('/app/game/camp-1?character=char-2&session=sess-new');
  });

  it('falls back to the sessions tab when the session has no character', () => {
    const now = new Date().toISOString();
    state.activeSessions = [
      { id: 'sess-1', character_id: null, start_time: now, created_at: now },
    ];
    renderOverview();

    fireEvent.click(screen.getByText('Resume Session'));

    expect(state.navigatedTo).toBe('/app/campaigns/camp-1/sessions');
  });

  it('ignores sessions past the expiry window', () => {
    state.activeSessions = [
      {
        id: 'sess-expired',
        character_id: 'char-1',
        start_time: '2020-01-01T00:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
      },
    ];
    renderOverview();

    // No resumable session: the Resume button is not shown.
    expect(screen.queryByText('Resume Session')).toBeNull();
  });
});
