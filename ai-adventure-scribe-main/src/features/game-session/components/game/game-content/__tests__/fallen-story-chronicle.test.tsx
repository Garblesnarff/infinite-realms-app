import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FallenStoryLog } from '../DeathScreen';

// #2520 §4: "Read the story so far" carries a Log and a Chronicle tab. The chronicle tab reads
// and writes through the existing chronicles procedures; the Log tab is the saved session log.

const chronicleState = vi.hoisted(() => ({
  data: null as null | { status: string; chapterTitle?: string | null; chronicleText?: string },
  isLoading: false,
  generatePending: false,
  generateError: false,
  mutate: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({
    messages: [],
    historyReady: true,
    hasMore: false,
    loadMore: vi.fn(),
    isLoading: false,
    isFetchingMore: false,
    messagesError: null,
  }),
}));

vi.mock('@/infrastructure/api', () => ({
  trpc: {
    useUtils: () => ({
      chronicles: { getBySessionId: { invalidate: chronicleState.invalidate } },
    }),
    chronicles: {
      getBySessionId: {
        useQuery: () => ({ data: chronicleState.data, isLoading: chronicleState.isLoading }),
      },
      generate: {
        useMutation: () => ({
          mutate: chronicleState.mutate,
          isPending: chronicleState.generatePending,
          isError: chronicleState.generateError,
        }),
      },
    },
  },
}));

describe('FallenStoryLog chronicle tab (#2520 §4)', () => {
  beforeEach(() => {
    chronicleState.data = null;
    chronicleState.isLoading = false;
    chronicleState.generatePending = false;
    chronicleState.generateError = false;
    chronicleState.mutate.mockReset();
    chronicleState.invalidate.mockReset();
  });

  it('without a session id the story is the log alone, with no tabs', () => {
    render(<FallenStoryLog />);

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByText('The story so far is still being written.')).toBeInTheDocument();
  });

  it('with a session id it offers Log and Chronicle, Log first', () => {
    render(<FallenStoryLog sessionId="session-1" />);

    expect(screen.getByRole('tab', { name: 'Log' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Chronicle' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('offers to write a chronicle when none exists, and writes it on request', () => {
    render(<FallenStoryLog sessionId="session-1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chronicle' }));

    expect(screen.getByText('No chronicle yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Write the chronicle' }));
    expect(chronicleState.mutate).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('shows the chronicle text once it is ready', () => {
    chronicleState.data = {
      status: 'ready',
      chapterTitle: 'The Scholar in the Membrane of Regret',
      chronicleText: 'The Scholar went down into the dark.',
    };
    render(<FallenStoryLog sessionId="session-1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chronicle' }));

    expect(
      screen.getByRole('heading', { name: 'The Scholar in the Membrane of Regret' }),
    ).toBeInTheDocument();
    expect(screen.getByText('The Scholar went down into the dark.')).toBeInTheDocument();
  });

  it('says the chronicle could not be written and offers a retry when generation failed', () => {
    chronicleState.data = { status: 'failed' };
    render(<FallenStoryLog sessionId="session-1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chronicle' }));

    expect(screen.getByRole('alert')).toHaveTextContent('The chronicle could not be written.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(chronicleState.mutate).toHaveBeenCalledWith({ sessionId: 'session-1' });
  });

  it('shows the writing state while the chronicle is generating', () => {
    chronicleState.data = { status: 'generating' };
    render(<FallenStoryLog sessionId="session-1" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Chronicle' }));

    expect(screen.getByRole('status')).toHaveTextContent('Writing the chronicle…');
  });
});
