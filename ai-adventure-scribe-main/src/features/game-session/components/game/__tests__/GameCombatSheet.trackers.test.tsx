/**
 * #1095 (Hark S2-002): out of combat, 'Open Tracker' showed only the
 * 'Combat Ready' panel — 'Prepare for battle! Your party is ready to
 * engage enemies.' — and no campaign tracker values at all.
 *
 * The fix: the sheet's combat/out-of-combat branch follows server
 * state (the server-synced combat context), and out of combat the
 * sheet shows the campaign trackers from GET /v1/sessions/:id/trackers
 * instead of the Combat Ready card.
 *
 * Mirrors the `GameCombatSheet.test.tsx` (#2257) mocks; only the combat
 * state differs (no server encounter) and the fetch stub answers.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { GameCombatSheet } from '../game-content/GameCombatSheet';

import { TooltipProvider } from '@/components/ui/tooltip';
import { useOptionalCombat } from '@/contexts/CombatContext';
import { useCombatActions } from '@/hooks/use-combat-actions';

vi.mock('@/hooks/use-combat-actions', () => ({ useCombatActions: vi.fn() }));

const mocks = vi.hoisted(() => ({ encounter: null as unknown, messages: [] as unknown[] }));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: { activeEncounter: mocks.encounter, isInCombat: false } }),
  // #1095: the sheet branches on the optional combat context. A mock
  // function (not a plain closure) so a test can pin the absent-
  // provider branch by returning undefined.
  useOptionalCombat: vi.fn(() => ({
    state: { activeEncounter: mocks.encounter, isInCombat: false },
  })),
}));
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAssetImageUrl: () => null }),
}));
vi.mock('@/contexts/MessageContext', () => ({
  useMessageContext: () => ({ messages: mocks.messages }),
}));

describe('GameCombatSheet: campaign trackers out of combat (#1095)', () => {
  const sessionId = 'session-1095';
  const fetchStub = vi.fn();

  beforeEach(() => {
    mocks.messages = [];
    mocks.encounter = null;
    vi.mocked(useOptionalCombat).mockReturnValue({
      state: { activeEncounter: null, isInCombat: false },
    } as never);
    // Out of combat on the server: no encounter, combat mode off. On
    // main this shape renders the Combat Ready card — the behavior
    // under test — instead of crashing on an undefined hook return.
    vi.mocked(useCombatActions).mockReturnValue({
      state: { showCombatLog: false },
      activeEncounter: null,
      isInCombat: false,
      playerParticipants: [],
      enemyParticipants: [],
      isPlayersTurn: false,
      selectedEnemy: null,
      setSelectedEnemy: vi.fn(),
      showCombatMode: false,
      isStartingCombat: false,
      actionValidation: null,
      reactionOpportunities: [],
      setReactionOpportunities: vi.fn(),
      localShowInitiativeTracker: false,
      setLocalShowInitiativeTracker: vi.fn(),
      handleStartCombat: vi.fn(),
      handleEndCombat: vi.fn(),
      handleCombatAction: vi.fn(),
      handleEnemyAttack: vi.fn(),
      addEnemy: vi.fn(),
      handleEnhancedAttack: vi.fn(),
      handleRacialTraitUse: vi.fn(),
      handleClassFeature: vi.fn(),
      handleReactionOpportunity: vi.fn(),
      handleDeathSave: vi.fn(),
      handleConcentrationSave: vi.fn(),
      handleTwoWeaponAttack: vi.fn(),
      handleApplyDamage: vi.fn(),
      handleHealing: vi.fn(),
      nextTurn: vi.fn(),
      rollInitiative: vi.fn(),
      showAdvantageModal: false,
      setShowAdvantageModal: vi.fn(),
      pendingAttack: null,
      setPendingAttack: vi.fn(),
    } as never);
    fetchStub.mockReset();
    fetchStub.mockImplementation(async (url: string) => {
      if (String(url).includes('/trackers')) {
        return {
          ok: true,
          json: async () => ({
            trackers: [
              { name: 'Wall', value: 2, limit: 6 },
              { name: 'Doom', value: 1, limit: 4 },
            ],
          }),
        };
      }
      return { ok: false };
    });
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the campaign trackers, not the 'Combat Ready' panel, out of combat", async () => {
    render(
      <TooltipProvider>
        <GameCombatSheet
          showTracker
          setShowTracker={vi.fn()}
          isDM={false}
          sessionId={sessionId}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText('Wall Clock: 2/6')).toBeInTheDocument();
    expect(screen.getByText('Doom Clock: 1/4')).toBeInTheDocument();
    expect(screen.queryByText(/Combat Ready/)).toBeNull();
    expect(fetchStub).toHaveBeenCalledWith(
      expect.stringContaining(`/v1/sessions/${sessionId}/trackers`),
      expect.anything(),
    );
  });

  it('shows the trackers view when no combat provider exists (absent means no combat)', async () => {
    vi.mocked(useOptionalCombat).mockReturnValue(undefined as never);
    render(
      <TooltipProvider>
        <GameCombatSheet
          showTracker
          setShowTracker={vi.fn()}
          isDM={false}
          sessionId={sessionId}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText('Wall Clock: 2/6')).toBeInTheDocument();
    expect(screen.queryByText(/Combat Ready/)).toBeNull();
  });

  it('a failed GET is an error with a retry, not a false "no trackers"', async () => {
    fetchStub.mockImplementation(async () => ({ ok: false }));
    render(
      <TooltipProvider>
        <GameCombatSheet
          showTracker
          setShowTracker={vi.fn()}
          isDM={false}
          sessionId={sessionId}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText(/Couldn't load campaign trackers/)).toBeInTheDocument();
    expect(screen.queryByText(/No campaign trackers/)).toBeNull();
    fetchStub.mockImplementation(async (url: string) => {
      if (String(url).includes('/trackers')) {
        return {
          ok: true,
          json: async () => ({
            trackers: [{ name: 'Wall', value: 2, limit: 6 }],
          }),
        };
      }
      return { ok: false };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Wall Clock: 2/6')).toBeInTheDocument();
  });

  it('an all-malformed tracker list is a load failure, not "no trackers"', async () => {
    fetchStub.mockImplementation(async (url: string) => {
      if (String(url).includes('/trackers')) {
        return {
          ok: true,
          json: async () => ({ trackers: [{ name: 1, value: 'x', limit: 0 }] }),
        };
      }
      return { ok: false };
    });
    render(
      <TooltipProvider>
        <GameCombatSheet
          showTracker
          setShowTracker={vi.fn()}
          isDM={false}
          sessionId={sessionId}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText(/Couldn't load campaign trackers/)).toBeInTheDocument();
    expect(screen.queryByText(/No campaign trackers/)).toBeNull();
  });

  it('says so when the campaign has no trackers, rather than showing Combat Ready', async () => {
    fetchStub.mockImplementation(async (url: string) => {
      if (String(url).includes('/trackers')) {
        return { ok: true, json: async () => ({ trackers: [] }) };
      }
      return { ok: false };
    });
    render(
      <TooltipProvider>
        <GameCombatSheet
          showTracker
          setShowTracker={vi.fn()}
          isDM={false}
          sessionId={sessionId}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText(/No campaign trackers/)).toBeInTheDocument();
    expect(screen.queryByText(/Combat Ready/)).toBeNull();
  });
});
