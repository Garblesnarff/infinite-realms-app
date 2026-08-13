/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The browser combat pipeline, end to end, against the real wiring.
 *
 * Everything below the seam is real: CombatProvider, combatReducer, useAuthoritativeCombatSync,
 * mapAuthoritativeCombat and useAIResponse. Only the edges are stubbed — `fetch` (so the
 * `/v1/combat/sessions/:id/active` read can be scripted), the DM service, and the sibling
 * contexts useAIResponse happens to consume. A test that mocked CombatContext would prove
 * nothing here, because CombatContext is the thing that was switched off.
 */
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { CombatProvider, useCombat } from '@/contexts/CombatContext';
import { useAIResponse } from '@/hooks/use-ai-response';
import { AIService } from '@/services/ai-service';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(() => ({ state: { character: null } })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 'user-1' }, userPlan: 'pro' })),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
  getAccessToken: vi.fn(() => 'test'),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    startStructuredCombat: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    resolveAoECast: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/voice-consistency-service', () => ({
  voiceConsistencyService: {
    getSessionVoiceContext: vi.fn().mockResolvedValue({ knownCharacters: {} }),
    processVoiceAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn().mockResolvedValue({
    playerRollRequests: [],
    npcRollResults: [],
    npcRollContinuationText: '',
  }),
}));
vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SESSION_ID = 'session-abc';

const narrativeResponse = {
  text:
    'The goblin snarls.\n\nA. **Take in your surroundings**, study the scene for details.\n' +
    'B. **Speak up**, address whoever is present.\n' +
    'C. **Act on instinct**, follow your gut and make a bold move.',
  narrationSegments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combat_actions: [],
};

/** The `combat` envelope the server returns from `/active` and broadcasts as combat_state_updated. */
const combatPayload = (status: 'active' | 'completed') => ({
  encounter: {
    id: 'enc-1',
    sessionId: SESSION_ID,
    status,
    currentRound: 2,
    currentTurnOrder: 0,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: status === 'completed' ? '2026-01-01T00:10:00.000Z' : null,
  },
  participants: [
    {
      id: 'pc-1',
      characterId: 'char-1',
      name: 'Rook',
      participantType: 'player',
      initiative: 18,
      initiativeModifier: 2,
      armorClass: 16,
      maxHp: 24,
      speed: 30,
      isActive: true,
      status: { currentHp: 24, maxHp: 24, tempHp: 0, isConscious: true },
    },
    {
      id: 'npc-1',
      name: 'Goblin',
      participantType: 'monster',
      initiative: 11,
      initiativeModifier: 1,
      armorClass: 15,
      maxHp: 7,
      speed: 30,
      isActive: true,
      status: { currentHp: 7, maxHp: 7, tempHp: 0, isConscious: true },
    },
  ],
});

/** Scripts `/v1/combat/sessions/:id/active` for the whole suite. */
let activeResponse: { status: 'active' | 'completed' } | null = null;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <CombatProvider sessionId={SESSION_ID}>{children}</CombatProvider>
);

const broadcastCombatState = (status: 'active' | 'completed') =>
  act(() => {
    window.dispatchEvent(
      new CustomEvent('combat-state-updated', { detail: { combat: combatPayload(status) } }),
    );
  });

beforeEach(() => {
  vi.clearAllMocks();
  activeResponse = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!String(url).includes('/active')) throw new Error(`unexpected fetch: ${url}`);
      if (!activeResponse) return { ok: false, status: 404, json: async () => ({}) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ combat: combatPayload(activeResponse.status) }),
      };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browser combat state follows server truth', () => {
  it('reports in-combat once a structured start is broadcast, without any client dispatch', async () => {
    const { result } = renderHook(() => useCombat(), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.state.isInCombat).toBe(false);

    // This is exactly the frame publishCombatState emits on 'combat_started'.
    broadcastCombatState('active');

    expect(result.current.state.isInCombat).toBe(true);
    expect(result.current.state.activeEncounter?.id).toBe('enc-1');
    expect(result.current.state.activeEncounter?.currentTurnParticipantId).toBe('pc-1');
    expect(result.current.state.activeEncounter?.participants).toHaveLength(2);
  });

  it('hydrates from /active when the page loads mid-fight', async () => {
    activeResponse = { status: 'active' };
    const { result } = renderHook(() => useCombat(), { wrapper });
    await waitFor(() => expect(result.current.state.isInCombat).toBe(true));
    expect(result.current.state.activeEncounter?.currentRound).toBe(2);
  });

  it('clears combat when the server ends the fight with no client action', async () => {
    activeResponse = { status: 'active' };
    const { result } = renderHook(() => useCombat(), { wrapper });
    await waitFor(() => expect(result.current.state.isInCombat).toBe(true));

    // endCombatIfResolved fires server-side on a killing blow; the browser is only told.
    broadcastCombatState('completed');

    expect(result.current.state.isInCombat).toBe(false);
    expect(result.current.state.activeEncounter).toBeNull();
  });

  it('clears combat when a refresh finds the encounter gone', async () => {
    activeResponse = { status: 'active' };
    const { result } = renderHook(() => useCombat(), { wrapper });
    await waitFor(() => expect(result.current.state.isInCombat).toBe(true));

    activeResponse = null; // server now 404s: no active encounter
    await act(async () => {
      await result.current.refreshCombatState();
    });

    expect(result.current.state.isInCombat).toBe(false);
    expect(result.current.state.activeEncounter).toBeNull();
  });

  it('leaves the manual combat button path alone', async () => {
    const { result } = renderHook(() => useCombat(), { wrapper });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await act(async () => {
      await result.current.startCombat('current-session', [{ name: 'Rook' }]);
    });
    expect(result.current.state.isInCombat).toBe(true);

    // The server has never heard of a client-minted encounter, so its silence must not end it.
    await act(async () => {
      await result.current.refreshCombatState();
    });
    expect(result.current.state.isInCombat).toBe(true);
    expect(result.current.state.activeEncounter?.origin).toBe('local');
  });

  it('keeps combat running when the server is unreachable', async () => {
    activeResponse = { status: 'active' };
    const { result } = renderHook(() => useCombat(), { wrapper });
    await waitFor(() => expect(result.current.state.isInCombat).toBe(true));

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    await act(async () => {
      await result.current.refreshCombatState();
    });

    expect(result.current.state.isInCombat).toBe(true);
  });
});

describe('the DM turn reads server combat truth', () => {
  beforeEach(() => {
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: SESSION_ID,
      campaign_id: 'c',
      character_id: 'ch',
      campaign: { id: 'c' },
      character: { id: 'ch', name: 'Rook' },
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({
      ok: true,
      json: async () => ({ tacticalContext: 'ASCII map + ACTIVE line' }),
    } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue(narrativeResponse as any);
  });

  it('fetches tactical context and tells the DM it is in combat', async () => {
    activeResponse = { status: 'active' };
    const { result } = renderHook(() => ({ combat: useCombat(), ai: useAIResponse() }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.combat.state.isInCombat).toBe(true));

    await act(async () => {
      await result.current.ai.getAIResponse(
        [{ text: 'I attack', sender: 'player', timestamp: new Date().toISOString() }] as any,
        SESSION_ID,
      );
    });

    expect(userDataApi.getTacticalMapContext).toHaveBeenCalledWith(SESSION_ID, 'pc-1');
    expect(AIService.chatWithDM).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          gameState: expect.objectContaining({
            isInCombat: true,
            encounterId: 'enc-1',
            round: 2,
            tacticalContext: 'ASCII map + ACTIVE line',
          }),
        }),
      }),
    );
  });

  it('sees a fight that started after the hook was rendered out of combat', async () => {
    const { result } = renderHook(() => ({ combat: useCombat(), ai: useAIResponse() }), {
      wrapper,
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current.combat.state.isInCombat).toBe(false);

    // Combat began between renders; only the server knows yet.
    activeResponse = { status: 'active' };

    await act(async () => {
      await result.current.ai.getAIResponse(
        [{ text: 'I attack', sender: 'player', timestamp: new Date().toISOString() }] as any,
        SESSION_ID,
      );
    });

    expect(userDataApi.getTacticalMapContext).toHaveBeenCalledWith(SESSION_ID, 'pc-1');
    expect(AIService.chatWithDM).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          gameState: expect.objectContaining({ isInCombat: true }),
        }),
      }),
    );
    expect(result.current.combat.state.isInCombat).toBe(true);
  });

  it('does not fetch tactical context out of combat', async () => {
    const { result } = renderHook(() => ({ combat: useCombat(), ai: useAIResponse() }), {
      wrapper,
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await act(async () => {
      await result.current.ai.getAIResponse(
        [{ text: 'I look around', sender: 'player', timestamp: new Date().toISOString() }] as any,
        SESSION_ID,
      );
    });

    expect(userDataApi.getTacticalMapContext).not.toHaveBeenCalled();
    expect(AIService.chatWithDM).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          gameState: expect.objectContaining({ isInCombat: false }),
        }),
      }),
    );
  });
});
