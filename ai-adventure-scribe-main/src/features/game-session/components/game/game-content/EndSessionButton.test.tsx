import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { EndSessionButton } from './EndSessionButton';

const mocks = vi.hoisted(() => ({ complete: vi.fn(), navigate: vi.fn() }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { completeSession: mocks.complete } }));

beforeEach(() => {
  vi.clearAllMocks();
});

it('ends the session and navigates to the hero game URL with no continue flag (#1703)', async () => {
  mocks.complete.mockResolvedValueOnce({});
  render(
    <EndSessionButton
      sessionId="session"
      campaignId="campaign"
      characterId="hero"
      starterCampaignId="starter"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith('session'));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith(
      '/app/game/campaign?character=hero&starterCampaign=starter',
      { state: { sessionEnded: true } },
    ),
  );
});

it('omits starterCampaign on custom campaigns and still uses no continue flag (#1703)', async () => {
  mocks.complete.mockResolvedValueOnce({});
  render(
    <EndSessionButton
      sessionId="session"
      campaignId="campaign"
      characterId="hero"
      starterCampaignId={null}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  await waitFor(() => expect(mocks.complete).toHaveBeenCalledWith('session'));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith('/app/game/campaign?character=hero', {
      state: { sessionEnded: true },
    }),
  );
});

it('reports an error and stays in the game if ending fails', async () => {
  mocks.complete.mockRejectedValueOnce(new Error('failed'));
  render(
    <EndSessionButton
      sessionId="session"
      campaignId="campaign"
      characterId="hero"
      starterCampaignId="starter"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'End session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not end session');
  expect(mocks.navigate).not.toHaveBeenCalled();
});
