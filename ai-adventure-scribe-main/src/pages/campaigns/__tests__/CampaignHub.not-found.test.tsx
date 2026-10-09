import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { CampaignProvider } from '@/contexts/CampaignContext';
import CampaignHub from '@/pages/campaigns/CampaignHub';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(async () => null),
  },
}));

describe('Campaign not found (#2706)', () => {
  it('offers a way back to /app', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CampaignProvider>
          <MemoryRouter initialEntries={['/app/campaigns/missing']}>
            <Routes>
              <Route path="/app/campaigns/:id/*" element={<CampaignHub />} />
            </Routes>
          </MemoryRouter>
        </CampaignProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Campaign not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to your campaigns' })).toHaveAttribute(
      'href',
      '/app',
    );
  });
});
