/**
 * #1239 item 4 — the Legend gate shows on the "Create your own hero" entry,
 * before the wizard opens. Free players never reach the wizard.
 *
 * The wizard itself is stubbed: the gate is the unit under test, and the
 * assertions pin gate-visible vs wizard-visible vs picker-visible, never
 * wizard internals. The campaign-picker query is stubbed to an empty list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import CharacterCreateEntry from '@/pages/CharacterCreateEntry';

// Mutable flag, read at render time (after each test sets it).
let flagOn = false;
vi.mock('@/config/featureFlags', () => ({
  isCampaignCharacterFlowEnabled: () => flagOn,
}));

vi.mock('@/components/character-creation/character-wizard', () => ({
  default: () => <div>Wizard stub</div>,
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listPublicCampaignTemplates: () => Promise.resolve([]),
  },
}));

// Mutable plan state, read at render time (after each test sets it).
const authState: {
  userPlan: string | null;
  userPlanLoading: boolean;
  userPlanError: boolean;
  refreshUserPlan: ReturnType<typeof vi.fn>;
} = {
  userPlan: 'free',
  userPlanLoading: false,
  userPlanError: false,
  refreshUserPlan: vi.fn(),
};
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState,
  useOptionalAuth: () => authState,
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
});

const renderEntry = (initialEntry = '/app/characters/create') =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/app/characters/create" element={<CharacterCreateEntry />} />
          <Route path="/app/characters/new" element={<CharacterCreateEntry />} />
          <Route path="/app/account" element={<div>Account page</div>} />
          <Route path="/app/characters" element={<div>Roster page</div>} />
          <Route path="/app/campaigns/:id" element={<div>Campaign page</div>} />
          <Route path="/explore" element={<div>Explore page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const GATE_HEADING = 'Creating your own hero is a Legend feature';

describe('CharacterCreateEntry Legend gate (#1239 item 4)', () => {
  beforeEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    flagOn = false;
    authState.userPlan = 'free';
    authState.userPlanLoading = false;
    authState.userPlanError = false;
    authState.refreshUserPlan = vi.fn();
  });

  it('free plan sees the Legend gate, never the wizard', () => {
    renderEntry();

    expect(screen.getByText(GATE_HEADING)).toBeInTheDocument();
    expect(screen.getByText('Upgrade to Legend')).toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
  });

  it('free plan Upgrade button goes to the account page', () => {
    renderEntry();

    fireEvent.click(screen.getByText('Upgrade to Legend'));
    expect(screen.getByText('Account page')).toBeInTheDocument();
  });

  it('free plan Back button goes to the character roster', () => {
    renderEntry();

    fireEvent.click(screen.getByText('Back to characters'));
    expect(screen.getByText('Roster page')).toBeInTheDocument();
  });

  it('free plan Browse button goes to the premade explore page', () => {
    renderEntry();

    fireEvent.click(screen.getByText('Browse premade heroes'));
    expect(screen.getByText('Explore page')).toBeInTheDocument();
  });

  it('free plan arriving from a campaign goes back to that campaign', () => {
    renderEntry('/app/characters/new?campaign=camp-1');

    expect(screen.getByText(GATE_HEADING)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back to campaign'));
    expect(screen.getByText('Campaign page')).toBeInTheDocument();
  });

  it('free plan on the /new route sees the gate too', () => {
    renderEntry('/app/characters/new');

    expect(screen.getByText(GATE_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
  });

  it('paid plan (pro) reaches the wizard, never the gate', () => {
    authState.userPlan = 'pro';
    renderEntry();

    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
    expect(screen.queryByText(GATE_HEADING)).not.toBeInTheDocument();
  });

  it('tester plan reaches the wizard (tester is a paid plan)', () => {
    authState.userPlan = 'tester';
    renderEntry();

    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
  });

  it('enterprise plan reaches the wizard', () => {
    authState.userPlan = 'enterprise';
    renderEntry();

    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
  });

  it('uppercase plan reaches the wizard (the helper lowercases)', () => {
    authState.userPlan = 'Pro';
    renderEntry();

    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
  });

  it('loading plan shows loading, neither wizard nor gate', () => {
    authState.userPlan = null;
    authState.userPlanLoading = true;
    renderEntry();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
    expect(screen.queryByText(GATE_HEADING)).not.toBeInTheDocument();
  });

  it('null plan without an error shows loading, never the gate', () => {
    authState.userPlan = null;
    renderEntry();

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText('Plan unavailable')).not.toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
  });

  it('failed plan fetch with no known plan shows Plan unavailable with a retry', () => {
    authState.userPlan = null;
    authState.userPlanError = true;
    renderEntry();

    expect(screen.getByText('Plan unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
    expect(screen.queryByText(GATE_HEADING)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Retry'));
    expect(authState.refreshUserPlan).toHaveBeenCalledOnce();
  });

  it('failed fetch with a known paid plan still reaches the wizard', () => {
    authState.userPlan = 'pro';
    authState.userPlanError = true;
    renderEntry();

    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
    expect(screen.queryByText('Plan unavailable')).not.toBeInTheDocument();
  });

  it('failed fetch with a known free plan still shows the gate', () => {
    authState.userPlan = 'free';
    authState.userPlanError = true;
    renderEntry();

    expect(screen.getByText(GATE_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Plan unavailable')).not.toBeInTheDocument();
  });

  it('retry recovery: a recovered plan clears the unavailable card', () => {
    authState.userPlan = null;
    authState.userPlanError = true;
    authState.refreshUserPlan = vi.fn(() => {
      authState.userPlan = 'pro';
      authState.userPlanError = false;
    });
    const { rerender } = renderEntry();

    expect(screen.getByText('Plan unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/app/characters/create']}>
          <Routes>
            <Route path="/app/characters/create" element={<CharacterCreateEntry />} />
            <Route path="/app/characters/new" element={<CharacterCreateEntry />} />
            <Route path="/app/account" element={<div>Account page</div>} />
            <Route path="/app/characters" element={<div>Roster page</div>} />
            <Route path="/app/campaigns/:id" element={<div>Campaign page</div>} />
            <Route path="/explore" element={<div>Explore page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
  });

  it('flag ON + free shows the gate, never the campaign picker', async () => {
    flagOn = true;
    renderEntry();

    expect(screen.getByText(GATE_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Choose a Campaign')).not.toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
  });

  it('flag ON + paid shows the campaign picker', async () => {
    flagOn = true;
    authState.userPlan = 'pro';
    renderEntry();

    expect(await screen.findByText('Choose a Campaign')).toBeInTheDocument();
    expect(screen.queryByText(GATE_HEADING)).not.toBeInTheDocument();
  });

  it('preselected campaign + free shows the gate, never the wizard', () => {
    renderEntry('/app/characters/new?campaign=camp-1');

    expect(screen.getByText(GATE_HEADING)).toBeInTheDocument();
    expect(screen.queryByText('Wizard stub')).not.toBeInTheDocument();
  });

  it('preselected campaign + paid reaches the wizard', () => {
    authState.userPlan = 'pro';
    renderEntry('/app/characters/new?campaign=camp-1');

    expect(screen.getByText('Wizard stub')).toBeInTheDocument();
    expect(screen.queryByText(GATE_HEADING)).not.toBeInTheDocument();
  });
});
