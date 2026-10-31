import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FallenStoryLog } from '../DeathScreen';

import { useMessages } from '@/hooks/use-messages';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({ userDataApi: { listSessionMessages: vi.fn() } }));
let sharedQuery: ReturnType<typeof useMessages>;
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => {
    const query = sharedQuery;
    return {
      messages: query.data,
      historyReady: query.historyReady,
      hasMore: query.hasMore,
      loadMore: query.loadMore,
      isLoading: query.isLoading,
      isFetchingMore: query.isFetching && !query.isLoading,
      messagesError: query.error,
    };
  },
}));

function Harness() {
  const [showStory, setShowStory] = React.useState(false);
  sharedQuery = useMessages('session');
  return (
    <>
      <button onClick={sharedQuery.loadMore}>Earlier chat</button>
      <button onClick={() => setShowStory(true)}>Open story</button>
      {showStory && <FallenStoryLog />}
    </>
  );
}

// The session route returns newest-page-first, each page in chronological order.
const row = (id: number) => ({
  id: `row-${id}`,
  message: id === 1 ? 'The beginning.' : id === 51 ? 'The final round.' : `Turn ${id}.`,
  speaker_type: 'dm',
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, id)).toISOString(),
  sequence_number: id,
  context: {},
});

describe('finished story history', () => {
  it('loads the older page and retries that page after a failure', async () => {
    vi.mocked(userDataApi.listSessionMessages)
      .mockResolvedValueOnce({
        messages: Array.from({ length: 50 }, (_, i) => row(i + 2)),
        total: 51,
        hasMore: true,
      })
      .mockRejectedValueOnce(new Error('History unavailable'))
      .mockResolvedValueOnce({ messages: [row(1)], total: 51, hasMore: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open story' }));
    expect(await screen.findByText('The final round.')).toBeInTheDocument();
    const retry = await screen.findByRole('button', { name: 'Retry loading earlier story' });
    fireEvent.click(retry);
    expect(await screen.findByText('The beginning.')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /earlier story/i })).not.toBeInTheDocument(),
    );
    expect(vi.mocked(userDataApi.listSessionMessages).mock.calls.map((call) => call[1])).toEqual([
      0, 50, 50,
    ]);
  });

  it('continues loading when older chat pages were opened before the story', async () => {
    vi.mocked(userDataApi.listSessionMessages).mockReset();
    vi.mocked(userDataApi.listSessionMessages)
      .mockResolvedValueOnce({
        messages: Array.from({ length: 50 }, (_, i) => row(i + 52)),
        total: 101,
        hasMore: true,
      })
      .mockResolvedValueOnce({
        messages: Array.from({ length: 50 }, (_, i) => row(i + 2)),
        total: 101,
        hasMore: true,
      })
      .mockResolvedValueOnce({ messages: [row(1)], total: 101, hasMore: false });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(sharedQuery.historyReady).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Earlier chat' }));
    await waitFor(() => expect(sharedQuery.data).toHaveLength(100));
    fireEvent.click(screen.getByRole('button', { name: 'Open story' }));
    expect(await screen.findByText('The beginning.')).toBeInTheDocument();
    expect(vi.mocked(userDataApi.listSessionMessages).mock.calls.map((call) => call[1])).toEqual([
      0, 50, 100,
    ]);
  });
});
