/**
 * #1669: an ended session opened by its link offers two different things. Resume session asks the
 * server to reopen THIS session; Start new session goes through the continuation path. Nothing is
 * created or resumed just by opening the link.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EndedSessionChoice } from '../EndedSessionChoice';

import { userDataApi } from '@/services/user-data-api';

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    resumeSession: vi.fn(),
    createSession: vi.fn(),
  },
}));

const renderChoice = (): ReturnType<typeof render> =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <EndedSessionChoice
          sessionId="s-ended"
          campaignId="camp-1"
          characterId="char-1"
          sessionNumber={1}
          sceneDescription="The gate of Harrowmere."
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe('EndedSessionChoice (#1669)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers Start new session and Resume session as two separate buttons', () => {
    renderChoice();
    expect(screen.getByRole('button', { name: 'Start new session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeInTheDocument();
  });

  it('Resume session asks the server to reopen this session, and only that', async () => {
    vi.mocked(userDataApi.resumeSession).mockResolvedValue({ id: 's-ended', status: 'active' });
    // jsdom cannot reload; the reload is replaced so the test can see the call happened.
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    renderChoice();
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(userDataApi.resumeSession).toHaveBeenCalledWith('s-ended');
    expect(userDataApi.createSession).not.toHaveBeenCalled();
  });

  it('Start new session creates a continuation and never resumes the ended one', async () => {
    vi.mocked(userDataApi.createSession).mockResolvedValue({ id: 's-new', session_number: 2 });

    renderChoice();
    fireEvent.click(screen.getByRole('button', { name: 'Start new session' }));

    await waitFor(() => expect(userDataApi.createSession).toHaveBeenCalledTimes(1));
    expect(userDataApi.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        campaign_id: 'camp-1',
        character_id: 'char-1',
        status: 'active',
        session_number: 2,
      }),
    );
    expect(userDataApi.resumeSession).not.toHaveBeenCalled();
  });

  it('shows the server refusal in words when Resume session is refused', async () => {
    vi.mocked(userDataApi.resumeSession).mockRejectedValue(
      new Error('This hero has fallen. Start a new session instead.'),
    );

    renderChoice();
    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));

    expect(
      await screen.findByText('This hero has fallen. Start a new session instead.'),
    ).toBeInTheDocument();
  });
});
