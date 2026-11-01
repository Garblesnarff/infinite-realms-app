import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { EndSessionButton } from './EndSessionButton';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/use-starter-campaigns', () => ({
  useStarterCampaigns: () => ({
    campaigns: [{ id: 'starter', slug: 'adventure' }],
    isLoading: false,
  }),
}));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { completeSession: mocks.complete } }));

beforeEach(() => {
  vi.clearAllMocks();
});
it('ends the session before returning to the adventure', async () => {
  mocks.complete.mockResolvedValueOnce({});
  render(
    <EndSessionButton sessionId="session" campaignId="campaign" starterCampaignId="starter" />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith('session'));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/explore/adventure'));
});
it('reports an error and stays in the game if ending fails', async () => {
  mocks.complete.mockRejectedValueOnce(new Error('failed'));
  render(
    <EndSessionButton sessionId="session" campaignId="campaign" starterCampaignId="starter" />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not end session');
  expect(mocks.navigate).not.toHaveBeenCalled();
});
