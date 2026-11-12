import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GamePanelControls } from '../../game-content/GamePanelControls';

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
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
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

import { TooltipProvider } from '@/components/ui/tooltip';
import { sessionStartGameTarget } from '@/features/session-start/session-start-decision';
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

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const mockProChronicle: ChronicleRow = {
  id: 'chron-1',
  sessionId: SESSION_ID,
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
  sessionId: SESSION_ID,
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

function renderControls(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/app/game/c1?session=${SESSION_ID}`]}>
      <Routes>
        <Route
          path="/app/game/:id"
          element={
            <TooltipProvider>
              <GamePanelControls
                isLeftCollapsed={false}
                isRightCollapsed={false}
                showSceneBlurb={false}
                onLeftToggle={vi.fn()}
                onRightToggle={vi.fn()}
                onSceneBlurbToggle={vi.fn()}
              />
            </TooltipProvider>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GameChronicleButton integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('opens the owner dialog for a paid plan', async () => {
    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );

    renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Chronicle' }));

    expect(await screen.findByText('Chapter I: Dragon Battle')).toBeInTheDocument();
    expect(screen.getByText('SESSION CHRONICLE · SESSION 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share this chronicle' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Anyone with the link can read this chronicle. They see the story and the art. They do not see your notes or your sheet. You can turn the link off in the campaign menu.',
      ),
    ).toBeInTheDocument();
    expect(vi.mocked(trpc.chronicles.getBySessionId.useQuery)).toHaveBeenCalledWith(
      { sessionId: SESSION_ID },
      expect.anything(),
    );
  });

  it('opens the free dialog for a free plan', async () => {
    mockUseAuth.mockReturnValue({ userPlan: 'free' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockFreeChronicle),
    );

    renderControls();

    fireEvent.click(screen.getByRole('button', { name: 'Chronicle' }));

    expect(await screen.findByText('First paragraph only.')).toBeInTheDocument();
    expect(screen.queryByText('Second paragraph hidden.')).not.toBeInTheDocument();
    expect(screen.getByText('Read the full chronicle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upgrade to Legend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share this chronicle' })).not.toBeInTheDocument();
    expect(vi.mocked(trpc.chronicles.getBySessionId.useQuery)).toHaveBeenCalledWith(
      { sessionId: SESSION_ID },
      expect.anything(),
    );
  });

  it('uses the resolved sessionId prop when the continue URL has no session param', async () => {
    const RESOLVED_SESSION_ID = '22222222-2222-2222-2222-222222222222';
    const url = sessionStartGameTarget({
      campaignId: 'c1',
      characterId: 'char-1',
      decision: { kind: 'continue', starterCampaignId: null },
    });
    expect(url).not.toBeNull();
    expect(new URL(url ?? '', 'http://localhost').searchParams.get('session')).toBeNull();
    expect(url).not.toContain('session=');

    mockUseAuth.mockReturnValue({ userPlan: 'pro' });
    vi.mocked(trpc.chronicles.getBySessionId.useQuery).mockReturnValue(
      mockSuccessResult(mockProChronicle),
    );

    render(
      <MemoryRouter initialEntries={[url ?? '/app/game/c1?character=char-1']}>
        <Routes>
          <Route
            path="/app/game/:id"
            element={
              <TooltipProvider>
                <GamePanelControls
                  isLeftCollapsed={false}
                  isRightCollapsed={false}
                  showSceneBlurb={false}
                  onLeftToggle={vi.fn()}
                  onRightToggle={vi.fn()}
                  onSceneBlurbToggle={vi.fn()}
                  sessionId={RESOLVED_SESSION_ID}
                />
              </TooltipProvider>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Chronicle' }));

    expect(await screen.findByText('Chapter I: Dragon Battle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share this chronicle' })).toBeInTheDocument();
    expect(vi.mocked(trpc.chronicles.getBySessionId.useQuery)).toHaveBeenCalledWith(
      { sessionId: RESOLVED_SESSION_ID },
      expect.anything(),
    );
  });
});
