import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CHRONICLE_SHARE_REQUEST } from '../../../../../../../shared/chronicle-share-routes';
import ChronicleDialog from '../ChronicleDialog';

import type { AppRouter } from '@/infrastructure/api/trpc-types';
import type { inferRouterOutputs } from '@trpc/server';
import type * as ReactRouterDOM from 'react-router-dom';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDOM>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/infrastructure/api', () => ({
  trpc: {
    chronicles: {
      getBySessionId: {
        useQuery: vi.fn(),
      },
      generate: {
        useMutation: vi.fn(() => ({
          mutate: vi.fn(),
          mutateAsync: vi.fn().mockResolvedValue(undefined),
          isPending: false,
        })),
      },
    },
    useUtils: vi.fn(() => ({
      chronicles: {
        getBySessionId: {
          invalidate: vi.fn().mockResolvedValue(undefined),
        },
      },
    })),
  },
}));

const mockFetchWithAuth = vi.fn();
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: (...args: unknown[]) => mockFetchWithAuth(...args),
}));

import { trpc } from '@/infrastructure/api';

type GetBySessionIdOutput = inferRouterOutputs<AppRouter>['chronicles']['getBySessionId'];
type ChronicleRow = NonNullable<GetBySessionIdOutput>;
type GetBySessionIdQueryResult = ReturnType<typeof trpc.chronicles.getBySessionId.useQuery>;

function mockSuccessResult(data: GetBySessionIdOutput): GetBySessionIdQueryResult {
  return {
    data,
    dataUpdatedAt: Date.now(),
    error: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'idle',
    isEnabled: true,
    isError: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isLoading: false,
    isLoadingError: false,
    isPaused: false,
    isPending: false,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: false,
    isSuccess: true,
    promise: Promise.resolve(data),
    refetch: vi.fn(),
    status: 'success',
    trpc: { path: 'chronicles.getBySessionId' },
  };
}

const mockProChronicle: ChronicleRow = {
  id: 'chron-1',
  sessionId: 'sess-1',
  userId: 'user-1',
  sessionNumber: 3,
  status: 'ready',
  chronicleText: 'First paragraph of the story.\n\nSecond paragraph of the story.',
  chapterTitle: 'Chapter I: Dragon Battle',
  previouslyOn: 'The party entered the cave.',
  illustrationUrl: 'https://example.com/dragon.jpg',
  shareToken: null,
  shareEnabled: false,
  generatedAt: '2026-10-12T12:00:00.000Z',
  errorMessage: null,
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
};

const mockFreeChronicle: ChronicleRow = {
  id: 'chron-2',
  sessionId: 'sess-1',
  userId: 'user-1',
  sessionNumber: 3,
  status: 'ready',
  chronicleText: 'First paragraph only.\n\nSecond paragraph hidden.',
  chapterTitle: 'Free Chapter',
  previouslyOn: null,
  illustrationUrl: null,
  shareToken: null,
  shareEnabled: false,
  generatedAt: '2026-10-12T12:00:00.000Z',
  errorMessage: null,
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
};

describe('ChronicleDialog', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeTextMock.mockReset();
    writeTextMock.mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const renderComponent = (props: Record<string, unknown> = {}): ReturnType<typeof render> => {
    return render(
      <MemoryRouter>
        <ChronicleDialog sessionId="sess-1" open={true} onClose={vi.fn()} {...props} />
      </MemoryRouter>,
    );
  };

  it('owner view renders title, story, Share, privacy line verbatim', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );

    renderComponent();

    expect(screen.getByText('Chapter I: Dragon Battle')).toBeInTheDocument();
    expect(screen.getByText('First paragraph of the story.')).toBeInTheDocument();
    expect(screen.getByText('Second paragraph of the story.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share this chronicle' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Anyone with the link can read this chronicle. They see the story and the art. They do not see your notes or your sheet. You can turn the link off in the campaign menu.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('clicking Share posts the share request, copies the link and shows Link copied!', async () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );
    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ shareToken: 'token-abc' }),
    });

    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Share this chronicle' }));

    expect(await screen.findByText('Link copied!')).toBeInTheDocument();
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetchWithAuth.mock.calls[0] as [string, Record<string, unknown>];
    expect(url.endsWith(CHRONICLE_SHARE_REQUEST.path('chron-1'))).toBe(true);
    expect(options.method).toBe(CHRONICLE_SHARE_REQUEST.method);
    expect(options.body).toBeUndefined();
    expect(writeTextMock).toHaveBeenCalledWith(`${window.location.origin}/chronicle/token-abc`);
  });

  it('share error shows Could not share. Try again.', async () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );
    mockFetchWithAuth.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Share this chronicle' }));

    expect(await screen.findByText('Could not share. Try again.')).toBeInTheDocument();
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('share 409 shows Write the full chronicle before sharing.', async () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );
    mockFetchWithAuth.mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });

    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Share this chronicle' }));

    expect(await screen.findByText('Write the full chronicle before sharing.')).toBeInTheDocument();
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('free plan shows only first paragraph, upgrade card and no Share button', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'free' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockFreeChronicle),
    );

    renderComponent();

    expect(screen.getByText('First paragraph only.')).toBeInTheDocument();
    expect(screen.queryByText('Second paragraph hidden.')).not.toBeInTheDocument();
    expect(screen.getByText('Read the full chronicle')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The Legend plan writes the full story of each session, with an illustration, and lets you share it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Legend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share this chronicle' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Legend' }));
    expect(mockNavigate).toHaveBeenCalledWith('/account');
  });

  it('eyebrow shows session number from the typed query', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );

    renderComponent();

    expect(screen.getByText('SESSION CHRONICLE · SESSION 3')).toBeInTheDocument();
  });

  it('summary-only paid owner sees Write the full chronicle and no Share', async () => {
    const summaryChronicle: ChronicleRow = {
      ...mockProChronicle,
      id: 'chron-summary',
      chapterTitle: null,
      chronicleText: 'Summary paragraph only.',
      illustrationUrl: null,
    };
    const mutateAsyncMock = vi.fn().mockResolvedValue(undefined);
    const invalidateMock = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(summaryChronicle),
    );
    vi.mocked(trpc.chronicles.generate.useMutation).mockReturnValue({
      mutate: vi.fn(),
      mutateAsync: mutateAsyncMock,
      isPending: false,
    } as unknown as ReturnType<typeof trpc.chronicles.generate.useMutation>);
    vi.mocked(trpc.useUtils).mockReturnValue({
      chronicles: { getBySessionId: { invalidate: invalidateMock } },
    } as unknown as ReturnType<typeof trpc.useUtils>);

    renderComponent();

    expect(screen.getByText('Summary paragraph only.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share this chronicle' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write the full chronicle' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Write the full chronicle' }));

    expect(mutateAsyncMock).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    await act(async () => {});
    expect(invalidateMock).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(await screen.findByText('Writing the full chronicle…')).toBeInTheDocument();
  });

  it('keeps polling while upgrading until chapterTitle appears (real QueryClient)', async () => {
    vi.useFakeTimers();
    try {
      const summaryChronicle: ChronicleRow = {
        ...mockProChronicle,
        id: 'chron-summary',
        chapterTitle: null,
        chronicleText: 'Summary paragraph only.',
        illustrationUrl: null,
      };
      const fullChronicle: ChronicleRow = {
        ...mockProChronicle,
        chapterTitle: 'Chapter I: Dragon Battle',
        chronicleText: 'First paragraph of the story.\n\nSecond paragraph of the story.',
      };
      let serverState: ChronicleRow = summaryChronicle;
      let queryFnCalls = 0;
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
      });
      mockUseAuth.mockReturnValue({ userPlan: 'pro' });

      vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockImplementation((input, opts) => {
        const result = useQuery({
          queryKey: [
            'chronicle-upgrade-test',
            (input as { sessionId?: string } | undefined)?.sessionId,
          ],
          queryFn: () => {
            queryFnCalls += 1;
            return serverState;
          },
          enabled: (opts as { enabled?: boolean } | undefined)?.enabled,
          refetchInterval: (opts as { refetchInterval?: unknown } | undefined)
            ?.refetchInterval as never,
          retry: false,
        });
        return { ...result, trpc: { path: 'chronicles.getBySessionId' } } as never;
      });

      let resolveMutation!: (value: unknown) => void;
      const mutationPromise = new Promise((resolve) => {
        resolveMutation = resolve;
      });

      vi.mocked(trpc.chronicles.generate.useMutation).mockImplementation((opts) => {
        const mutation = useMutation({
          mutationFn: () => mutationPromise as Promise<unknown>,
          ...((opts as unknown as Record<string, unknown> | undefined) ?? {}),
        });
        return mutation as never;
      });

      vi.mocked(trpc.useUtils).mockImplementation(
        () =>
          ({
            chronicles: {
              getBySessionId: {
                invalidate: (invalidateInput: { sessionId: string }) =>
                  queryClient.invalidateQueries({
                    queryKey: ['chronicle-upgrade-test', invalidateInput.sessionId],
                  }),
              },
            },
          }) as never,
      );

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>
            <ChronicleDialog sessionId="sess-1" open={true} onClose={vi.fn()} />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.getByText('Summary paragraph only.')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Share this chronicle' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Write the full chronicle' })).toBeInTheDocument();
      const callsAfterInitialFetch = queryFnCalls;
      expect(callsAfterInitialFetch).toBeGreaterThan(0);

      fireEvent.click(screen.getByRole('button', { name: 'Write the full chronicle' }));
      expect(screen.getByText('Writing the full chronicle…')).toBeInTheDocument();

      await act(async () => {
        resolveMutation({});
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        screen.queryByRole('button', { name: 'Share this chronicle' }),
      ).not.toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(queryFnCalls).toBeGreaterThan(callsAfterInitialFetch);
      expect(
        screen.queryByRole('button', { name: 'Share this chronicle' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Writing the full chronicle…')).toBeInTheDocument();

      serverState = fullChronicle;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.getByRole('button', { name: 'Share this chronicle' })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows Could not write the full chronicle on generate failure (real QueryClient)', async () => {
    const summaryChronicle: ChronicleRow = {
      ...mockProChronicle,
      id: 'chron-summary',
      chapterTitle: null,
      chronicleText: 'Summary paragraph only.',
      illustrationUrl: null,
    };
    const serverState: ChronicleRow = summaryChronicle;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, staleTime: 0, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });

    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockImplementation((input, opts) => {
      const result = useQuery({
        queryKey: [
          'chronicle-error-test',
          (input as { sessionId?: string } | undefined)?.sessionId,
        ],
        queryFn: () => serverState,
        enabled: (opts as { enabled?: boolean } | undefined)?.enabled,
        refetchInterval: (opts as { refetchInterval?: unknown } | undefined)
          ?.refetchInterval as never,
        retry: false,
      });
      return { ...result, trpc: { path: 'chronicles.getBySessionId' } } as never;
    });

    vi.mocked(trpc.chronicles.generate.useMutation).mockImplementation((opts) => {
      const mutation = useMutation({
        mutationFn: () => Promise.reject(new Error('boom')),
        ...((opts as unknown as Record<string, unknown> | undefined) ?? {}),
      });
      return mutation as never;
    });

    vi.mocked(trpc.useUtils).mockImplementation(
      () =>
        ({
          chronicles: {
            getBySessionId: {
              invalidate: () => Promise.resolve(),
            },
          },
        }) as never,
    );

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <ChronicleDialog sessionId="sess-1" open={true} onClose={vi.fn()} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('Summary paragraph only.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Write the full chronicle' }));

    expect(
      await screen.findByText('Could not write the full chronicle. Try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share this chronicle' })).not.toBeInTheDocument();
  });
});
