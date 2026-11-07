import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CHRONICLE_SHARE_REQUEST } from '../../../../../../../shared/test-fixtures/chronicle-share-wire';
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
    },
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
    mockFetchWithAuth.mockResolvedValue({ ok: false, status: 409, json: async () => ({}) });

    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: 'Share this chronicle' }));

    expect(await screen.findByText('Could not share. Try again.')).toBeInTheDocument();
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
        'The Pro plan writes the full story of each session, with an illustration, and lets you share it.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Pro' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share this chronicle' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Upgrade to Pro' }));
    expect(mockNavigate).toHaveBeenCalledWith('/account');
  });
});
