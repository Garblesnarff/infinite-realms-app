import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CampaignList from '@/features/campaign/components/list/campaign-list';
import CampaignSelectionModal from '@/features/character/components/list/campaign-selection-modal';

const listCampaigns = vi.fn();

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listCampaigns: (...args: unknown[]) => listCampaigns(...args),
    createSession: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/features/campaign/components/list/campaign-card', () => ({
  MemoizedCampaignCard: ({ campaign }: { campaign: { name: string } }) => (
    <div data-testid="home-campaign">{campaign.name}</div>
  ),
}));

vi.mock('@/features/character/components/list/campaign-card', () => ({
  default: ({ campaign }: { campaign: { name: string } }) => (
    <div data-testid="picker-campaign">{campaign.name}</div>
  ),
}));

const campaigns = [
  {
    id: 'c1',
    name: 'Sunken Archive',
    genre: 'mystery',
    status: 'active',
    created_at: '2026-09-01',
  },
  { id: 'c2', name: 'Ember Road', genre: 'fantasy', status: 'active', created_at: '2026-09-02' },
];

class RequestError extends Error {
  constructor(public readonly status: number) {
    super(`Request failed with status ${status}`);
  }
}

// Mirror the production QueryClient defaults (src/lib/trpc/Provider.tsx).
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 5 * 60_000, retry: 1, retryDelay: 0 } },
  });
}

function wrap(client: QueryClient, ui: React.ReactElement): React.ReactElement {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

function picker(openIndex: number | null, count = 5): React.ReactElement {
  // One modal per character card, as character-card.tsx mounts them.
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <CampaignSelectionModal
          key={i}
          isOpen={i === openIndex}
          onClose={() => undefined}
          characterId={`char-${i}`}
        />
      ))}
    </>
  );
}

describe('campaigns list requests (#2149)', () => {
  beforeEach(() => {
    listCampaigns.mockReset();
  });

  it('character picker: closed modals on every card send no request; opening one sends exactly one', async () => {
    listCampaigns.mockResolvedValue(campaigns);
    const client = makeClient();
    const { rerender } = render(wrap(client, picker(null)));

    await new Promise((r) => setTimeout(r, 20));
    expect(listCampaigns).toHaveBeenCalledTimes(0);

    rerender(wrap(client, picker(2)));
    expect(await screen.findAllByTestId('picker-campaign')).toHaveLength(2);
    expect(listCampaigns).toHaveBeenCalledTimes(1);

    // Re-render and open a different character's modal: served from cache.
    rerender(wrap(client, picker(4)));
    rerender(wrap(client, picker(4)));
    expect(await screen.findAllByTestId('picker-campaign')).toHaveLength(2);
    expect(listCampaigns).toHaveBeenCalledTimes(1);
  });

  it('home list: mount sends exactly one request; re-render, search and sort send zero more', async () => {
    listCampaigns.mockResolvedValue(campaigns);
    const client = makeClient();
    const { rerender } = render(wrap(client, <CampaignList />));

    expect(await screen.findAllByTestId('home-campaign')).toHaveLength(2);
    expect(listCampaigns).toHaveBeenCalledTimes(1);

    rerender(wrap(client, <CampaignList />));
    rerender(wrap(client, <CampaignList searchTerm="emb" />));
    rerender(wrap(client, <CampaignList searchTerm="emb" sortBy="name" />));

    expect(await screen.findAllByTestId('home-campaign')).toHaveLength(1);
    expect(screen.getByText('Ember Road')).toBeInTheDocument();
    expect(listCampaigns).toHaveBeenCalledTimes(1);
  });

  it('home list and picker share one cached request', async () => {
    listCampaigns.mockResolvedValue(campaigns);
    const client = makeClient();
    render(
      wrap(
        client,
        <>
          <CampaignList />
          {picker(0)}
        </>,
      ),
    );

    expect(await screen.findAllByTestId('home-campaign')).toHaveLength(2);
    expect(await screen.findAllByTestId('picker-campaign')).toHaveLength(2);
    expect(listCampaigns).toHaveBeenCalledTimes(1);
  });

  it('home list: a failed request renders the retry UI, not an empty roster, and Retry refetches', async () => {
    listCampaigns.mockRejectedValue(new RequestError(500));
    const client = makeClient();
    render(wrap(client, <CampaignList />));

    expect(await screen.findByText("Couldn't load — retry")).toBeInTheDocument();
    expect(screen.queryByText('No Campaigns Found')).not.toBeInTheDocument();

    listCampaigns.mockResolvedValue(campaigns);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findAllByTestId('home-campaign')).toHaveLength(2);
    expect(screen.queryByText("Couldn't load — retry")).not.toBeInTheDocument();
  });

  it('home list: a 429 is not auto-retried and renders the retry UI', async () => {
    listCampaigns.mockRejectedValue(new RequestError(429));
    const client = makeClient();
    render(wrap(client, <CampaignList />));

    expect(await screen.findByText("Couldn't load — retry")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(listCampaigns).toHaveBeenCalledTimes(1);
  });

  it('picker: a failed request renders the retry UI instead of "No Campaigns Available"', async () => {
    listCampaigns.mockRejectedValue(new RequestError(429));
    const client = makeClient();
    render(wrap(client, picker(0, 1)));

    expect(await screen.findByText("Couldn't load — retry")).toBeInTheDocument();
    expect(screen.queryByText('No Campaigns Available')).not.toBeInTheDocument();

    listCampaigns.mockResolvedValue(campaigns);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getAllByTestId('picker-campaign')).toHaveLength(2));
  });
});
