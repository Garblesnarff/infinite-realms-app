/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2386 A1 and A2 — the two ordinary in-combat turns that #2378 (PR #2385) did not reach.
 *
 * A1: the NPC turns that follow the player's turn used to run in a client pre-flight before the
 * DM call. Since #2658 step 3 the server runs them on the player's End turn and the response
 * carries them; their rows are written by the server and shown once.
 * A2: the turn that kills the last enemy ends combat inside the engine call. The DM's narration
 * pass may ask for a post-combat check; that request must survive, and must not withhold the
 * kill line behind its popup.
 *
 * Everything from the hook down to the dice bridge is real (the same wiring as
 * `use-ai-response.entry-gate-engine-lines.test.ts`); only the HTTP edges and the DM model are
 * stubbed.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../shared/npc-engine-message';
import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import type { LocalNotice } from '@/hooks/ai/types';

import { useCombat } from '@/contexts/CombatContext';
import { SILENT_PLAYER_TURN_NOTE } from '@/hooks/ai/silent-player-turn';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'combat', diceRollQueue: { pendingRolls: [] } },
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
    detectDeclaredAttack: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    fetchSessionFallenState: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/voice-consistency-service', () => ({
  voiceConsistencyService: {
    getSessionVoiceContext: vi.fn().mockResolvedValue({ knownCharacters: {} }),
    processVoiceAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/hooks/ai/game-phase-updater', () => ({
  updateGamePhase: vi.fn(),
  clampCombatIntentFlags: vi.fn((start, end) => ({
    shouldStartCombat: start,
    shouldEndCombat: end,
  })),
}));
vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const PLAYER_INPUT = 'I swing my staff at Professor Emil Darkwater';

const participants = [
  {
    id: 'emil-1',
    name: 'Professor Emil Darkwater',
    participantType: 'npc',
    turnOrder: 0,
    initiative: 7,
    isActive: true,
  },
  {
    id: 'scholar-1',
    characterId: declaredAttackCharacter.id,
    name: 'The Scholar',
    participantType: 'player',
    turnOrder: 1,
    initiative: 3,
    isActive: true,
  },
];
const encounterHeldBy = (participantId: string): Record<string, unknown> => ({
  id: 'enc-1',
  phase: 'active',
  currentTurnParticipantId: participantId,
  currentRound: 2,
  participants,
});

/** What Emil's swing returns from `advance-npc-turns`: the same shape as the #2385 fixture. */
const emilSwing = {
  results: [
    {
      action: {
        actor_id: 'emil-1',
        action_type: 'attack',
        target_ids: ['scholar-1'],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      outcomes: [],
      engineResult: {
        actorName: 'Professor Emil Darkwater',
        targetName: 'The Scholar',
        d20: 14,
        attackBonus: 3,
        totalAttackRoll: 17,
        targetAC: 11,
        hit: true,
        finalDamage: 4,
        damageType: 'bludgeoning',
        targetNewHp: 3,
        targetCondition: 'bloodied',
        weaponResolution: { resolved: 'Quarterstaff', substituted: false },
      },
      actorIsPlayer: false,
      transcriptLines: [],
    },
  ],
  currentParticipant: { id: 'scholar-1', name: 'The Scholar', participantType: 'player' },
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};
const EMIL_LINE =
  '⚙️ Engine: Professor Emil Darkwater rolled 14 + 3 = 17 vs AC 11 against The Scholar with Quarterstaff — HIT. 4 bludgeoning damage. The Scholar is now at 3 HP and is bloodied.';

/**
 * The NPC rows as the server writes them (#2658 step 3): `buildNpcEngineMessage` over each runner
 * result, keyed by the runner's actionId. The End turn response carries them, and the client's
 * executor dispatches them as `session-engine-rows` events.
 */
const npcRowsFor = (
  npcTurns: { results: Array<{ action: any; engineResult: any; round?: number }> },
  round: number,
) =>
  npcTurns.results.map((npcResult, index) => {
    const message = buildNpcEngineMessage(
      [
        { id: 'emil-1', name: 'Professor Emil Darkwater', participantType: 'npc' },
        { id: 'scholar-1', name: 'The Scholar', participantType: 'player', maxHp: 7 },
      ],
      npcResult.round ?? round,
      {
        type: npcResult.action.action_type,
        actorId: npcResult.action.actor_id,
        targetIds: npcResult.action.target_ids,
      },
      npcResult.engineResult,
    );
    const actionId = `enc-1:${npcResult.round ?? round}:${npcResult.action.actor_id}:${npcResult.action.action_type}`;
    return {
      id: `npc-row-${index}`,
      sequence: 100 + index,
      text: message.text,
      kind: 'npc',
      actionId,
      sessionId: DECLARED_ATTACK_SESSION_ID,
      timestamp: new Date().toISOString(),
      context: {
        ...message.context,
        npcResult: npcResult.engineResult,
        combatEncounterId: 'enc-1',
        actionId,
      },
    };
  });

/** Captures server-delivered NPC rows dispatched via the session-engine-rows event. */
const captureNpcRows = () => {
  const npcRows: Array<{ text: string; context: any }> = [];
  const capture = (event: Event) => {
    npcRows.push(...((event as CustomEvent).detail as Array<{ text: string; context: any }>));
  };
  window.addEventListener('session-engine-rows', capture);
  return { npcRows, stop: () => window.removeEventListener('session-engine-rows', capture) };
};

/** The DM's structured declaration for the player's typed swing. */
const declaredSwing = {
  actor_id: 'scholar-1',
  action_type: 'attack',
  target_ids: ['emil-1'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/**
 * A last kill as the server sends it: `combat-attack-service` result fields (a dead target reads
 * `near death` from `healthConditionForCombat`), plus the `combatEnded: true` that
 * `combat-intent-service` adds.
 */
const killingBlow = {
  actorName: 'The Scholar',
  targetName: 'Professor Emil Darkwater',
  d20: 18,
  attackBonus: 5,
  totalAttackRoll: 23,
  targetAC: 12,
  hit: true,
  finalDamage: 9,
  damageType: 'bludgeoning',
  targetNewHp: 0,
  targetIsConscious: false,
  targetIsDead: true,
  targetCondition: 'near death',
  weaponResolution: { resolved: 'Quarterstaff', substituted: false },
  combatEnded: true,
};
const KILL_LINE =
  '⚙️ Engine: The Scholar rolled 18 + 5 = 23 vs AC 12 against Professor Emil Darkwater with Quarterstaff — HIT. 9 bludgeoning damage. Professor Emil Darkwater is dead.';

const POST_COMBAT_CHECK = {
  type: 'skill_check' as const,
  formula: '1d20+3',
  purpose: 'Investigation check to search the study',
  dc: 12,
};

describe('useAIResponse: ordinary in-combat turns show their engine lines (#2386)', () => {
  let order: string[];
  let held: string;
  let commitResult: Record<string, unknown>;
  /** The creatures' turns the server runs on the player's End turn; null when it runs none. */
  let endTurnNpcTurns: any;
  let sent: Array<Record<string, any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    held = 'emil-1';
    commitResult = {};
    endTurnNpcTurns = null;
    sent = [];

    setPlayerRollHost({
      present: (spec, settle) => {
        order.push(`prompt: attack ${'weaponName' in spec ? spec.weaponName : 'other'}`);
        queueMicrotask(() => settle({ d20: 18 }));
        return { rollId: 'roll-attack', dismiss: () => {} };
      },
    });

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: null },
      // The board is gone once the last enemy dies (`held` is emptied by the killing blow).
      refreshCombatState: vi.fn(async () => (held ? encounterHeldBy(held) : null)),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: DECLARED_ATTACK_SESSION_ID,
      campaign_id: 'camp-1',
      character_id: declaredAttackCharacter.id,
      campaign: { id: 'camp-1' },
      character: declaredAttackCharacter,
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        sent.push(body);
        if (body.phase === 'propose') {
          return new Response(
            JSON.stringify({
              proposal: {
                movementOnly: false,
                legal: true,
                weaponName: 'Quarterstaff',
                attackBonus: 5,
                targetAc: 12,
                advantage: false,
                disadvantage: false,
                targetLabel: 'Professor Emil Darkwater',
              },
            }),
            { status: 200 },
          );
        }
        if (body.intent?.type === 'attack') {
          if (commitResult.combatEnded) held = '';
          return new Response(JSON.stringify({ result: commitResult }), { status: 200 });
        }
        const turn = { currentParticipant: { id: 'emil-1', name: 'Professor Emil Darkwater' } };
        if (body.intent?.type === 'end_turn' && endTurnNpcTurns) {
          // The intent route's body (#2658 step 3): the server ran the creatures before answering.
          const engineRows = npcRowsFor(endTurnNpcTurns, 2);
          held = endTurnNpcTurns.combatEnded ? '' : (endTurnNpcTurns.currentParticipant?.id ?? '');
          const npcTurns = { ...endTurnNpcTurns, engineRows };
          return new Response(
            JSON.stringify({
              accepted: true,
              result: { ...turn, npcTurns, engineRows },
              engineRows,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ result: turn }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  const play = (
    onEngineNotice?: (notice: LocalNotice) => void,
    text: string = PLAYER_INPUT,
  ): ReturnType<ReturnType<typeof useAIResponse>['getAIResponse']> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [{ text, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      onEngineNotice,
    );
  };

  // Migrated (#2658 step 3): was "A1: prints the NPC’s pre-flight swing, with the HP it left, before the player’s die prompt"
  it('A1: the NPC’s swing after the player’s turn arrives on the End turn response as one server row, with the HP it left', async () => {
    held = 'scholar-1';
    endTurnNpcTurns = emilSwing;
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'Emil staggers.', roll_requests: [] } as any);

    const { npcRows, stop } = captureNpcRows();
    try {
      const shown: LocalNotice[] = [];
      const response = await play((notice) => {
        order.push(`line: ${notice.text}`);
        shown.push(notice);
      });

      // The player's die first; the creature acts only once the player's turn has ended. The
      // client asks the server for nothing more: one End turn, keyed, and Emil came back on it.
      expect(order).toEqual(['prompt: attack Quarterstaff']);
      const ends = sent.filter((body) => body.intent?.type === 'end_turn');
      expect(ends).toHaveLength(1);
      expect(typeof ends[0].intent.actionId).toBe('string');
      expect(shown).toEqual([]);

      // Emil's swing arrives as a server-delivered NPC row with the HP it left and cards.
      expect(npcRows).toHaveLength(1);
      expect(npcRows[0].text).toBe(EMIL_LINE);
      const npcBlock = (npcRows[0].context as any).combatEngineBlocks[0];
      expect(npcBlock).toMatchObject({ source: 'npc' });
      expect(npcBlock.lines).toEqual([EMIL_LINE]);
      expect(npcBlock.cards[0]).toMatchObject({ kind: 'attack', line: EMIL_LINE });

      // Shown once: the reply does not print it a second time.
      expect(response.text).not.toContain(EMIL_LINE);
      expect(response.localNotices).toBeUndefined();
    } finally {
      stop();
    }
  });

  // Migrated (#2658 step 3): was "A1: a caller that cannot show lines early still gets the NPC line once, in the reply"
  it('A1: a caller that cannot show lines early still gets the End turn’s NPC row once, and not in the reply', async () => {
    held = 'scholar-1';
    endTurnNpcTurns = emilSwing;
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'Emil staggers.', roll_requests: [] } as any);

    // A caller without onEngineNotice still gets the NPC line via the server-delivered row,
    // once, and it is not duplicated in the reply text.
    const { npcRows, stop } = captureNpcRows();
    try {
      const response = await play();

      expect(npcRows).toHaveLength(1);
      expect(npcRows[0].text).toBe(EMIL_LINE);
      expect(npcRows[0].text.match(/rolled 14 \+ 3 = 17/g)).toHaveLength(1);
      expect(response.text).not.toContain(EMIL_LINE);
    } finally {
      stop();
    }
  });

  it('A2: a check the DM asks for after the killing blow survives, and the kill line is not held behind it', async () => {
    held = 'scholar-1';
    commitResult = killingBlow;
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'The professor crumples. The study falls quiet.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const shown: LocalNotice[] = [];
    const response = await play((notice) => {
      order.push(`line: ${notice.text}`);
      shown.push(notice);
    });

    // Combat ended inside the engine call, so the check is a post-combat one: the popup opens.
    expect(response.rollRequests).toEqual([POST_COMBAT_CHECK]);
    // The reply waits for that roll, so the kill line goes on screen on its own, once.
    expect(shown).toEqual([
      {
        text: KILL_LINE,
        persist: true,
        cards: [expect.objectContaining({ kind: 'attack', line: KILL_LINE })],
      },
    ]);
    expect(response.text).not.toContain(KILL_LINE);
    expect(response.context?.combatEngineBlocks).toBeUndefined();
    expect(response.context?.combatEnded).toBe(true);
  });

  it('A2: a caller that cannot show lines early keeps the kill line in the reply', async () => {
    held = 'scholar-1';
    commitResult = killingBlow;
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'The professor crumples. The study falls quiet.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const response = await play();

    expect(response.rollRequests).toEqual([POST_COMBAT_CHECK]);
    expect(response.text.startsWith(KILL_LINE)).toBe(true);
    expect(response.text.match(/rolled 18 \+ 5 = 23/g)).toHaveLength(1);
  });

  // Migrated (#2658 step 3): was "A1: a silent turn after a pre-flight NPC hit is not engine-free: right note, no false trailer, no fabrication flag"
  // The creatures now act on the End turn that precedes this message, never inside a silent turn
  // (a silent turn sends no intent, and only `/enter` still hands the client NPC turns): the
  // turn runs no creature, the narration is told plainly that nothing happened, and the NPC
  // results that were already narrated are not re-sent as this turn's.
  it('A1: a silent turn while the player holds the turn runs no creature and is engine-free: plain note, no NPC results re-narrated', async () => {
    held = 'scholar-1';
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({ text: 'You look around the study.', roll_requests: [] } as any)
      .mockResolvedValueOnce({ text: 'You scan the shelves.', roll_requests: [] } as any);

    const { npcRows, stop } = captureNpcRows();
    let response: Awaited<ReturnType<typeof play>>;
    try {
      const shown: LocalNotice[] = [];
      response = await play((notice) => shown.push(notice), 'I look around the study.');

      // No intent of any kind reached the engine, so no creature ran and no row arrived.
      expect(sent).toEqual([]);
      expect(npcRows).toEqual([]);
      expect(shown).toEqual([]);
    } finally {
      stop();
    }
    const narrationCall = vi.mocked(AIService.chatWithDM).mock.calls[1][0];
    const payload = JSON.parse(narrationCall.message);
    expect(payload.silentPlayerTurnNote).toBe(SILENT_PLAYER_TURN_NOTE);
    expect(payload.authoritativeCombatResults ?? []).toEqual([]);
    // Nothing was rolled this turn, and the trailer says exactly that.
    expect(response.text).toContain(
      '*(That was not a combat action — nothing was rolled. It is still your turn.)*',
    );
  });

  it('A2: while combat goes on, the DM’s roll requests stay dropped under the fresh flag', async () => {
    held = 'scholar-1';
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'Emil staggers.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const response = await play(() => {});

    expect(response.rollRequests).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'enc-1',
      type: 'skill_check',
      purpose: POST_COMBAT_CHECK.purpose,
    });
  });

  // Migrated (#2658 step 3): was "A1: a pre-flight that ends combat still shows its lines, once"
  it('A1: an End turn whose creatures end the fight still shows their line, once, and the turn reports it', async () => {
    held = 'scholar-1';
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    endTurnNpcTurns = { ...emilSwing, combatEnded: true, currentParticipant: null };
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'The professor lowers his staff.', roll_requests: [] } as any);

    const { npcRows, stop } = captureNpcRows();
    try {
      const shown: LocalNotice[] = [];
      const response = await play((notice) => shown.push(notice));

      // The NPC line arrives on the End turn response as a server-written row, once, with its card.
      expect(npcRows).toHaveLength(1);
      expect(npcRows[0].text).toBe(EMIL_LINE);
      const npcBlock = (npcRows[0].context as any).combatEngineBlocks[0];
      expect(npcBlock.cards[0]).toMatchObject({ kind: 'attack', line: EMIL_LINE });
      // No player engine notice on this path.
      expect(shown).toEqual([]);
      expect(response.text).not.toContain(EMIL_LINE);
      expect(response.text).toContain('The professor lowers his staff.');
      expect(response.context?.combatEnded).toBe(true);
    } finally {
      stop();
    }
  });

  it('#2517 D2 path: the NPC loop killing inside the player’s own turn sets the fallen state from the resolution', async () => {
    // Run D2's shape: the player holds the turn and acts; the enemy survives
    // the swing and the NPC loop inside the same resolution kills the player.
    held = 'scholar-1';
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    const emilKillingSwing = {
      ...emilSwing,
      results: [
        {
          ...emilSwing.results[0],
          engineResult: {
            ...emilSwing.results[0].engineResult,
            d20: 18,
            totalAttackRoll: 21,
            finalDamage: 9,
            targetNewHp: 0,
            targetIsConscious: false,
            targetIsDead: true,
            targetCondition: 'near death',
          },
        },
      ],
      currentParticipant: null,
      combatEnded: true,
      endedReason: 'party_defeated',
    };
    // #2658 step 3: the server runs Emil on the player's End turn, and the killing blow comes
    // back on that response (the board is gone after it).
    endTurnNpcTurns = emilKillingSwing;
    // Follows the real producer: fetchSessionFallenState reads
    // character_stats.vital_state from the session load payload.
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue({
      characterId: declaredAttackCharacter.id,
      characterName: 'The Scholar',
      campaignId: 'camp-1',
      campaignName: 'Abyssal Descent',
      starterCampaignId: null,
      diedAt: '2026-10-02T14:51:00.000Z',
    } as any);
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'Emil strikes back.', roll_requests: [] } as any);

    const { result } = renderHook(() => useAIResponse());
    const { npcRows, stop } = captureNpcRows();
    let response: Awaited<ReturnType<typeof result.current.getAIResponse>>;
    try {
      response = await result.current.getAIResponse(
        [{ text: PLAYER_INPUT, sender: 'player', timestamp: new Date().toISOString() }] as any,
        DECLARED_ATTACK_SESSION_ID,
        undefined,
        undefined,
        undefined,
        undefined,
        () => {},
      );
    } finally {
      stop();
    }

    // The DM path ran…
    expect(AIService.chatWithDM).toHaveBeenCalled();
    // The End turn is the one request that ran the NPC loop: keyed, and nothing after it.
    expect(
      sent
        .map((body) => body.intent?.type)
        .filter(Boolean)
        .at(-1),
    ).toBe('end_turn');
    expect(typeof sent.find((body) => body.intent?.type === 'end_turn')?.intent.actionId).toBe(
      'string',
    );
    expect(userDataApi.fetchSessionFallenState).toHaveBeenCalledWith(DECLARED_ATTACK_SESSION_ID);
    // …and the fallen state came out of the resolution itself: no further
    // message send was needed to surface it.
    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({ state: 'party_defeated' });
    });
    // The row carries the killing blow: Emil's roll and the Scholar's death.
    expect(npcRows).toHaveLength(1);
    expect(npcRows[0].text).toMatch(/Professor Emil Darkwater rolled 18 \+ 3 = 21/);
    expect(npcRows[0].text).toMatch(/The Scholar is (dead|now at 0 HP)/);
    const npcBlock = (npcRows[0].context as any).combatEngineBlocks[0];
    expect(npcBlock).toMatchObject({ source: 'npc' });
    // The end state shows the killing row the server wrote (#2518), not the player's own
    // earlier line: step 2 moved NPC lines out of the client blocks, so the last block was
    // the wrong source.
    expect(result.current.terminalDeathState?.finalLines).toEqual([npcRows[0].text]);
    // The turn still completes whole (round 3): the DM narration comes back
    // for the handler to save, and the killing engine row is carried into
    // the end state via the server-delivered row — the swap replaces a finished turn,
    // it does not truncate it.
    expect(response?.text).toContain('Emil strikes back.');
  });

  it('#2517: a victory ending the same way leaves the fallen state unset', async () => {
    held = 'scholar-1';
    commitResult = killingBlow;
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'The professor crumples. The study falls quiet.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const { result } = renderHook(() => useAIResponse());
    await result.current.getAIResponse(
      [{ text: PLAYER_INPUT, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
    );

    // The post-combat check ran and the character lives: no end state.
    expect(userDataApi.fetchSessionFallenState).toHaveBeenCalledWith(DECLARED_ATTACK_SESSION_ID);
    expect(result.current.terminalDeathState).toBeNull();
  });
});
