import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  burningHandsChipAoECast,
  magicMissileChipIntent,
} from '../../../../../shared/test-fixtures/spell-chip-casts';
import {
  TACTICAL_MAP_SESSION_ID,
  TACTICAL_MAP_WIZARD_ID,
  activeTacticalMapRead,
} from '../../../../../shared/test-fixtures/tactical-map-read';
import { useCombatLegalActions } from '../use-combat-legal-actions';

import type * as playerSpellCastModule from '@/services/combat/player-spell-cast';

import { markAuthReady } from '@/lib/auth-gate';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';
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

function routeFetch(chip: Record<string, unknown>, board: unknown = activeTacticalMapRead()) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: unknown, init?: unknown) => {
    const href = String(url);
    const raw = (init as { body?: string } | undefined)?.body;
    if (raw) calls.push({ url: href, body: JSON.parse(raw) as Record<string, unknown> });
    if (href.includes('/legal-actions')) {
      return {
        ok: true,
        json: async () => ({ actorId: TACTICAL_MAP_WIZARD_ID, actions: [chip] }),
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

async function press(chip: Record<string, unknown>, onSendText = vi.fn(async () => {})) {
  const { result } = renderHook(() =>
    useCombatLegalActions({ enabled: true, onSendMessage: vi.fn(), onSendText }),
  );
  await waitFor(() => expect(result.current.actions).toHaveLength(1));
  await act(async () => {
    await result.current.runAction(chip as never);
  });
  return { result, onSendText };
}

describe('save, auto-hit and area spell chips commit to the engine (#1227)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.mocked(requestSpellTargetSave).mockResolvedValue('continue');
    // The area route goes through userDataApi, which waits for sign-in.
    markAuthReady();
    combatHolder.current.state.activeEncounter = {
      id: 'enc-1227',
      sessionId: TACTICAL_MAP_SESSION_ID,
      currentTurnParticipantId: TACTICAL_MAP_WIZARD_ID,
      currentRound: 1,
      participants: [
        { id: TACTICAL_MAP_WIZARD_ID, participantType: 'player', name: 'Adda' },
        { id: TARGET_ID, participantType: 'monster', name: 'Rubble Sentinel' },
      ],
    };
  });

  it('commits Magic Missile with the chip slot and target, with no player die', async () => {
    const chip = {
      type: 'spell',
      label: 'Cast Magic Missile',
      spellId: 'magic-missile',
      targetIds: [TARGET_ID],
      slotLevel: 1,
    };
    const calls = routeFetch(chip);

    const { onSendText } = await press(chip);

    expect(onSendText).not.toHaveBeenCalled();
    const commits = calls.filter((call) => call.url.includes('/intent') && !call.body.phase);
    expect(commits).toHaveLength(1);
    expect(commits[0].body.intent).toEqual(
      magicMissileChipIntent(TACTICAL_MAP_WIZARD_ID, TARGET_ID),
    );
    expect(commits[0].body.origin).toBe('action_bar');
  });

  it("casts an upcast Burning Hands through the area route, aimed at the chip target's cell", async () => {
    const chip = {
      type: 'spell',
      label: 'Cast Burning Hands (2nd-level slot)',
      spellId: 'burning-hands',
      targetIds: [TARGET_ID],
      slotLevel: 2,
    };
    const calls = routeFetch(chip);

    const { onSendText } = await press(chip);

    expect(onSendText).not.toHaveBeenCalled();
    const casts = calls.filter((call) => call.url.endsWith('/aoe-cast'));
    expect(casts).toHaveLength(1);
    // The fixture board puts the Rubble Sentinel at (2, 2).
    expect(casts[0].body).toEqual(burningHandsChipAoECast(TACTICAL_MAP_WIZARD_ID, { x: 2, y: 2 }));
    expect(calls.some((call) => call.url.includes('/intent') && !call.body.phase)).toBe(false);
  });

  it('sends nothing for an area chip when the board cannot place the aim', async () => {
    const chip = {
      type: 'spell',
      label: 'Cast Burning Hands',
      spellId: 'burning-hands',
      targetIds: [TARGET_ID],
      slotLevel: 1,
    };
    const calls = routeFetch(chip, { map: null });

    const { result, onSendText } = await press(chip);

    expect(onSendText).not.toHaveBeenCalled();
    expect(calls.some((call) => call.url.endsWith('/aoe-cast'))).toBe(false);
    expect(result.current.error).toBe('That spell needs the battle map to aim. Nothing was spent.');
  });

  it('commits Acid Splash after the target-saves card, and sends nothing when it is cancelled', async () => {
    const chip = {
      type: 'spell',
      label: 'Cast Acid Splash',
      spellId: 'acid-splash',
      targetIds: [TARGET_ID],
    };
    const calls = routeFetch(chip);
    await press(chip);
    const commits = calls.filter((call) => call.url.includes('/intent') && !call.body.phase);
    expect(commits).toHaveLength(1);
    expect(commits[0].body.intent).toMatchObject({
      type: 'spell',
      spellId: 'acid-splash',
      targetIds: [TARGET_ID],
    });
    expect(commits[0].body.intent).not.toHaveProperty('d20');

    vi.restoreAllMocks();
    vi.mocked(requestSpellTargetSave).mockResolvedValue('cancel');
    const cancelledCalls = routeFetch(chip);
    const { result } = await press(chip);
    expect(cancelledCalls.some((call) => call.url.includes('/intent') && !call.body.phase)).toBe(
      false,
    );
    expect(result.current.error).toBe('The cast was cancelled. Nothing was spent.');
  });

  it('stops a refused Acid Splash before any intent POST, and shows the refusal', async () => {
    // #1231 round 2: a refusal stops the cast for every spell kind, not just attack
    // chips. Acid Splash is a save spell: before this fix its chip was committed
    // even when the prompt resolved refused, because the stop block required
    // spell.kind === 'attack'.
    const chip = {
      type: 'spell',
      label: 'Cast Acid Splash',
      spellId: 'acid-splash',
      targetIds: [TARGET_ID],
    };
    const calls = routeFetch(chip);
    vi.mocked(askPlayerForSpellCast).mockResolvedValueOnce({
      autoRolled: true,
      movementOnly: false,
      refusal: 'The spell was refused',
    });
    const { result } = await press(chip);

    expect(vi.mocked(askPlayerForSpellCast)).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.url.includes('/intent') && !call.body.phase)).toBe(false);
    expect(result.current.error).toBe('The spell was refused. Nothing was spent.');
  });
});
