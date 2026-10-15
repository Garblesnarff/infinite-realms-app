import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CampaignOverview from '../CampaignOverview';

import type * as ReactRouterDom from 'react-router-dom';

const state = vi.hoisted(() => ({
  serverSessions: [] as Array<{
    id: string;
    character_id: string | null;
    start_time: string;
    created_at: string;
  }>,
  navigatedTo: null as string | null,
  listSessions: vi.fn(),
}));

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
// Only the HTTP client is replaced. The QueryClient, the query key and the cache are real.
vi.mock('@/services/user-data-api', () => ({ userDataApi: { listSessions: state.listSessions } }));

/** Same defaults as the app's QueryClient (src/infrastructure/api/trpc-provider.tsx). */
const appQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { staleTime: 1000 * 60 * 5, retry: 1 } },
  });

function mountOverview(client: QueryClient): void {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/app/campaigns/camp-1']}>
        <Routes>
          <Route
            path="/app/campaigns/:id"
            element={
              <CampaignOverview campaign={{ id: 'camp-1', description: 'A test campaign' }} />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// #707 (Hark D5-002): leave the Overview, start a new session, come back. Resume must open
// the newest session, not the one the cache held 5 minutes ago.
describe('CampaignOverview Resume after a new session (#707)', () => {
  beforeEach(() => {
    state.navigatedTo = null;
    state.listSessions.mockImplementation(async () => state.serverSessions);
  });
  afterEach(() => cleanup());

  it('opens the session started after the first visit', async () => {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    state.serverSessions = [
      { id: 'sess-old', character_id: 'char-1', start_time: hourAgo, created_at: hourAgo },
    ];
    const client = appQueryClient();

    mountOverview(client);
    fireEvent.click(await screen.findByText('Resume Session'));
    expect(state.navigatedTo).toBe('/app/game/camp-1?character=char-1&session=sess-old');

    cleanup(); // the player leaves the Overview (Characters, then back)
    state.serverSessions = [
      ...state.serverSessions,
      { id: 'sess-new', character_id: 'char-1', start_time: now, created_at: now },
    ];

    mountOverview(client);
    await waitFor(() => expect(state.listSessions).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      state.navigatedTo = null;
      fireEvent.click(screen.getByText('Resume Session'));
      expect(state.navigatedTo).toBe('/app/game/camp-1?character=char-1&session=sess-new');
    });
  });
});
