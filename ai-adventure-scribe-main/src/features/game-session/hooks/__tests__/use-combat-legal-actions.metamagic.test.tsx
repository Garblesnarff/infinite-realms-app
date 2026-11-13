import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { metamagicMagicMissileBody } from '../../../../../shared/test-fixtures/metamagic-spell-intent';
import {
  TACTICAL_MAP_SESSION_ID,
  TACTICAL_MAP_WIZARD_ID,
  activeTacticalMapRead,
} from '../../../../../shared/test-fixtures/tactical-map-read';
import { useCombatLegalActions } from '../use-combat-legal-actions';

import type * as playerSpellCastModule from '@/services/combat/player-spell-cast';

import { markAuthReady } from '@/lib/auth-gate';
import { requestSpellTargetSave } from '@/services/combat/spell-target-save-bridge';

/**
 * #1227: a save, auto-hit or area spell chip commits to the engine with the chip's slot and
 * target, the way an attack-spell chip already did. It used to send its label to the DM, who
 * could cast it with another slot, at other targets, or narrate it without the engine. The
 * bodies asserted here are the shared fixtures the real-route test posts
 * (spell-chip-casts.real-db.test.ts). Only the network is stubbed.
 */
vi.mock('@/services/combat/spell-target-save-bridge', () => ({
  requestSpellTargetSave: vi.fn(),
}));

// #1231 round 2: the spell-cast prompt is the real implementation by default, so the
// save-card and cancel tests below keep exercising it; the refusal test overrides the
// one call with a refused resolution.
vi.mock('@/services/combat/player-spell-cast', async (importOriginal) => {
  const actual = await importOriginal<typeof playerSpellCastModule>();
  return {
    ...actual,
    askPlayerForSpellCast: vi.fn((...args: Parameters<typeof actual.askPlayerForSpellCast>) =>
      actual.askPlayerForSpellCast(...args),
    ),
  };
});

const TARGET_ID = 'rubble-sentinel-1';

const combatHolder = vi.hoisted(() => ({
  current: {
    state: {
      isInCombat: true,
      activeEncounter: {
        id: 'enc-1227',
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

type Call = { url: string; body: Record<string, unknown> };

function routeFetch(
  actions: Array<Record<string, unknown>>,
  board: unknown = activeTacticalMapRead(),
) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init?: unknown) => {
    const href = String(url);
    const raw = (init as { body?: string } | undefined)?.body;
    if (raw) calls.push({ url: href, body: JSON.parse(raw) as Record<string, unknown> });
    if (href.includes('/legal-actions')) {
      return {
        ok: true,
        json: async () => ({ actorId: TACTICAL_MAP_WIZARD_ID, actions }),
      } as Response;
    }
    if (href.endsWith('/tactical-map')) {
      return { ok: true, json: async () => board } as Response;
    }
    if (href.endsWith('/aoe-cast')) {
      return new Response(
        JSON.stringify({
          delta: { actorId: TACTICAL_MAP_WIZARD_ID, targets: [{ entityId: TARGET_ID }] },
          result: { results: [] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (href.includes('/intent')) {
      return { ok: true, json: async () => ({ accepted: true, result: {} }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  return calls;
}

const METAMAGIC_CHIP = {
  type: 'metamagic',
  label: 'Quickened Spell (2 sorcery points)',
  option: 'quickened',
  pointsCost: 2,
  castingTime: 'bonus action',
};
const MISSILE_CHIP = {
  type: 'spell',
  label: 'Cast Magic Missile',
  spellId: 'magic-missile',
  targetIds: [TARGET_ID],
  slotLevel: 1,
};

async function renderWith(actions: Array<Record<string, unknown>>) {
  const calls = routeFetch(actions);
  const { result } = renderHook(() =>
    useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText: vi.fn() }),
  );
  await waitFor(() => expect(result.current.actions).toHaveLength(actions.length));
  return { calls, result };
}

describe('Metamagic arms from More and rides the next spell cast (#1233)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(requestSpellTargetSave).mockResolvedValue('continue');
    markAuthReady();
    combatHolder.current.state.activeEncounter = {
      id: 'enc-1233',
      sessionId: TACTICAL_MAP_SESSION_ID,
      currentTurnParticipantId: TACTICAL_MAP_WIZARD_ID,
      currentRound: 1,
      participants: [
        { id: TACTICAL_MAP_WIZARD_ID, participantType: 'player', name: 'Sable' },
        { id: TARGET_ID, participantType: 'monster', name: 'Rubble Sentinel' },
      ],
    };
  });

  it('arming a known option posts no intent and shows it armed', async () => {
    const { calls, result } = await renderWith([METAMAGIC_CHIP]);
    await act(async () => {
      await result.current.runAction(METAMAGIC_CHIP as never);
    });
    expect(result.current.armedMetamagic).toBe('quickened');
    expect(calls.some((call) => call.url.includes('/intent'))).toBe(false);
  });

  it('the next spell cast carries the armed option, and the arm clears after the cast', async () => {
    const { calls, result } = await renderWith([METAMAGIC_CHIP, MISSILE_CHIP]);
    await act(async () => {
      await result.current.runAction(METAMAGIC_CHIP as never);
    });
    await act(async () => {
      await result.current.runAction(MISSILE_CHIP as never);
    });
    const commits = calls.filter((call) => call.url.includes('/intent') && !call.body.phase);
    expect(commits).toHaveLength(1);
    // The posted body is the shared wire fixture (the real-route suite posts the same one).
    expect(commits[0].body).toMatchObject(
      metamagicMagicMissileBody(TACTICAL_MAP_WIZARD_ID, TARGET_ID, 'quickened'),
    );
    expect(result.current.armedMetamagic).toBeNull();
  });

  it('pressing an armed option again disarms it, so the cast carries no option', async () => {
    const { calls, result } = await renderWith([METAMAGIC_CHIP, MISSILE_CHIP]);
    await act(async () => {
      await result.current.runAction(METAMAGIC_CHIP as never);
    });
    await act(async () => {
      await result.current.runAction(METAMAGIC_CHIP as never);
    });
    expect(result.current.armedMetamagic).toBeNull();
    await act(async () => {
      await result.current.runAction(MISSILE_CHIP as never);
    });
    const commits = calls.filter((call) => call.url.includes('/intent') && !call.body.phase);
    expect(commits).toHaveLength(1);
    expect((commits[0].body.intent as Record<string, unknown>).metamagic).toBeUndefined();
  });
});
