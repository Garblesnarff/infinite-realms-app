import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  TACTICAL_MAP_SESSION_ID,
  TACTICAL_MAP_WIZARD_ID,
  activeTacticalMapRead,
} from '../../../../../shared/test-fixtures/tactical-map-read';
import { useCombatLegalActions } from '../use-combat-legal-actions';

import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';

/**
 * #1185 part 2 (Hark, Brick by Brick rounds 1-3): every cast from the bar ended the turn
 * although the wizard had not moved. The movement read here is the real one, fed the body the
 * tactical-map route really returns (shared fixture, pinned server-side by
 * tactical-map-read-shape.test.ts). Only the network is stubbed.
 */
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
}));

const combatHolder = vi.hoisted(() => ({
  current: {
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1185',
        sessionId: '',
        currentTurnParticipantId: '',
        currentRound: 1,
        participants: [] as Array<{ id: string; participantType: string; name?: string }>,
      },
    },
    refreshCombatState: vi.fn(),
  },
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => combatHolder.current,
  useOptionalCombat: () => combatHolder.current,
}));

const castAction = {
  type: 'spell',
  label: 'Cast Chill Touch',
  spellId: 'chill-touch',
  targetIds: ['rubble-sentinel-1'],
};

function routeFetch(tacticalMapBody: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init?: unknown) => {
    const href = String(url);
    if (href.includes('/legal-actions')) {
      return {
        ok: true,
        json: async () => ({ actorId: TACTICAL_MAP_WIZARD_ID, actions: [castAction] }),
      } as Response;
    }
    if (href.endsWith('/tactical-map')) {
      return { ok: true, json: async () => tacticalMapBody } as Response;
    }
    if (href.includes('/intent')) {
      const body = JSON.parse(String((init as { body?: string }).body ?? '{}')) as {
        phase?: string;
      };
      if (body.phase === 'propose') {
        return {
          ok: true,
          json: async () => ({
            proposal: {
              movementOnly: false,
              spellId: 'chill-touch',
              spellName: 'Chill Touch',
              kind: 'attack',
              attackBonus: 5,
              saveDC: 13,
              targetAc: 11,
              advantage: false,
              disadvantage: false,
              targetLabel: 'Rubble Sentinel',
            },
          }),
        } as Response;
      }
      return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
    }
    return { ok: false, status: 404 } as Response;
  });
}

function committedIntentTypes(fetchSpy: ReturnType<typeof routeFetch>): string[] {
  return fetchSpy.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String((init as { body?: string } | undefined)?.body ?? '{}')) as {
        phase?: string;
        intent?: { type?: string };
      },
    }))
    .filter((call) => call.url.includes('/intent') && !call.body.phase)
    .map((call) => String(call.body.intent?.type));
}

describe('a bar cast settles on the real movement read (#1185)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 14 });
    combatHolder.current.state.activeEncounter = {
      id: 'enc-1185',
      sessionId: TACTICAL_MAP_SESSION_ID,
      currentTurnParticipantId: TACTICAL_MAP_WIZARD_ID,
      currentRound: 1,
      participants: [
        { id: TACTICAL_MAP_WIZARD_ID, participantType: 'player', name: 'Adda' },
        { id: 'rubble-sentinel-1', participantType: 'monster', name: 'Rubble Sentinel' },
      ],
    };
  });

  async function castOnce(fetchSpy: ReturnType<typeof routeFetch>): Promise<string[]> {
    const { result } = renderHook(() =>
      useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
    );
    await waitFor(() => expect(result.current.actions).toHaveLength(1));
    await act(async () => {
      await result.current.runAction(castAction as never);
    });
    return committedIntentTypes(fetchSpy);
  }

  it('keeps the turn open when the wizard has not moved', async () => {
    const fetchSpy = routeFetch(activeTacticalMapRead());

    expect(await castOnce(fetchSpy)).toEqual(['spell']);
  });

  it("ends the turn when the board shows the wizard's movement spent", async () => {
    const map = activeTacticalMapRead();
    map.entities[0].movementRemaining = 0;
    const fetchSpy = routeFetch(map);

    expect(await castOnce(fetchSpy)).toEqual(['spell', 'end_turn']);
  });
});
