import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ChronicleViewer from '../ChronicleViewer';

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

const mockToast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/infrastructure/api', () => ({
  trpc: {
    chronicles: {
      getBySessionId: {
        useQuery: vi.fn(),
      },
    },
  },
}));

import { trpc } from '@/infrastructure/api';

/**
 * Real producer output for `chronicles.getBySessionId`
 * (server-bun/src/trpc/routers/chronicles.ts): the 13 columns the drizzle
 * left-join select always returns (all nullable via the join), or null when
 * no chronicle row exists. Dates are ISO strings: tRPC v11's
 * `inferRouterOutputs` reflects the JSON-serialized wire shape the client
 * really receives, not the server-side Date objects.
 */
type GetBySessionIdOutput = inferRouterOutputs<AppRouter>['chronicles']['getBySessionId'];
type ChronicleRow = NonNullable<GetBySessionIdOutput>;

/** Exact return contract of `trpc.chronicles.getBySessionId.useQuery`. */
type GetBySessionIdQueryResult = ReturnType<typeof trpc.chronicles.getBySessionId.useQuery>;

/**
 * Query-result mocks with the full shape the real hook returns: the tRPC
 * hook marker plus the matching react-query discriminated-union member
 * (loading vs success). Each return-type annotation (never an `as` cast)
 * keeps the mock honest — if the react-query/tRPC contract changes, tsc
 * fails here instead of silently passing with a partial object.
 */
function mockLoadingResult(): GetBySessionIdQueryResult {
  return {
    data: undefined,
    dataUpdatedAt: 0,
    error: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    failureCount: 0,
    failureReason: null,
    fetchStatus: 'fetching',
    isEnabled: true,
    isError: false,
    isFetched: false,
    isFetchedAfterMount: false,
    isFetching: true,
    isInitialLoading: true,
    isLoading: true,
    isLoadingError: false,
    isPaused: false,
    isPending: true,
    isPlaceholderData: false,
    isRefetchError: false,
    isRefetching: false,
    isStale: true,
    isSuccess: false,
    promise: new Promise<GetBySessionIdOutput>(() => {}),
    refetch: vi.fn(),
    status: 'pending',
    trpc: { path: 'chronicles.getBySessionId' },
  };
}

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
  status: 'ready',
  chronicleText: 'The brave heroes fought valiantly against the dragon in the deep cavern.',
  chapterTitle: 'Chapter I: Dragon Battle',
  previouslyOn: 'The party entered the cave.',
  illustrationUrl: 'https://example.com/dragon.jpg',
  shareToken: 'token-12345678901234567890123456',
  generatedAt: '2026-10-12T12:00:00.000Z',
  errorMessage: null,
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
};

const mockFreeChronicle: ChronicleRow = {
  id: 'chron-2',
  sessionId: 'sess-1',
  userId: 'user-1',
  status: 'ready',
  chronicleText: 'Free summary: The heroes entered the cave and fought monsters.',
  chapterTitle: null,
  previouslyOn: null,
  illustrationUrl: null,
  shareToken: null,
  generatedAt: '2026-10-12T12:00:00.000Z',
  errorMessage: null,
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
};

const mockGeneratingChronicle: ChronicleRow = {
  id: 'chron-3',
  sessionId: 'sess-1',
  userId: 'user-1',
  status: 'generating',
  chronicleText: null,
  chapterTitle: null,
  previouslyOn: null,
  illustrationUrl: null,
  shareToken: null,
  generatedAt: null,
  errorMessage: null,
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
};

const mockFailedChronicle: ChronicleRow = {
  id: 'chron-4',
  sessionId: 'sess-1',
  userId: 'user-1',
  status: 'failed',
  chronicleText: null,
  chapterTitle: null,
  previouslyOn: null,
  illustrationUrl: null,
  shareToken: null,
  generatedAt: null,
  errorMessage: 'LLM error',
  createdAt: '2026-10-12T12:00:00.000Z',
  updatedAt: '2026-10-12T12:00:00.000Z',
};

describe('ChronicleViewer', () => {
  const writeTextMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });
  });

  const renderComponent = (props = {}) => {
    return render(
      <MemoryRouter>
        <ChronicleViewer sessionId="sess-1" open={true} onClose={vi.fn()} {...props} />
      </MemoryRouter>,
    );
  };

  it('renders loading state', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(mockLoadingResult());

    renderComponent();

    expect(screen.getByText('Loading chronicle...')).toBeInTheDocument();
  });

  it('renders empty state when chronicle is null', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(mockSuccessResult(null));

    renderComponent();

    expect(screen.getByText('No chronicle yet.')).toBeInTheDocument();
  });

  it('renders generating state', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockGeneratingChronicle),
    );

    renderComponent();

    expect(screen.getByText('Your chronicle is being written... ✨')).toBeInTheDocument();
  });

  it('renders failed state', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockFailedChronicle),
    );

    renderComponent();

    expect(screen.getByText('Chronicle generation failed.')).toBeInTheDocument();
  });

  it('renders paid Pro chronicle with title, prose, illustration and Share button', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );

    renderComponent();

    expect(screen.getByText('Chapter I: Dragon Battle')).toBeInTheDocument();
    expect(
      screen.getByText(
        'The brave heroes fought valiantly against the dragon in the deep cavern.',
      ),
    ).toBeInTheDocument();

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'https://example.com/dragon.jpg');
    expect(img).toHaveAttribute('alt', 'Chapter I: Dragon Battle');

    const shareButton = screen.getByRole('button', { name: /Share/i });
    expect(shareButton).toBeInTheDocument();

    fireEvent.click(shareButton);

    expect(writeTextMock).toHaveBeenCalledWith(
      `${window.location.origin}/chronicle/token-12345678901234567890123456`,
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Link copied!' });
  });

  it('renders free chronicle summary and upgrade UI', () => {
    mockUseAuth.mockReturnValue({ userPlan: 'free' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockFreeChronicle),
    );

    renderComponent();

    expect(
      screen.getByText('Free summary: The heroes entered the cave and fought monsters.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Upgrade to Pro for illustrated novel-style chronicles/i),
    ).toBeInTheDocument();

    const upgradeButton = screen.getByRole('button', { name: /Upgrade to Pro/i });
    expect(upgradeButton).toBeInTheDocument();

    fireEvent.click(upgradeButton);
    expect(mockNavigate).toHaveBeenCalledWith('/account');
  });
});
