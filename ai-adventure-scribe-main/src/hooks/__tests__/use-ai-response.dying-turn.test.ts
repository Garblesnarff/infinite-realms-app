/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2518 — the dying player's turn, end to end through the client.
 *
 * Run D2 (#2516) rolled two death saves for the Scholar inside one enemy resolution. The rules
 * give the player ONE save per turn, rolled by the player, with the monsters' turns in between.
 * Here the turn reaches a player at 0 HP and the whole client path runs for real: `useAIResponse`,
 * the dying-turn declaration, `handleDmActionsAndTransitions`, `resolveDeclaredCombatActions`, the
 * real client executor posting the intent, the player-roll bridge (a fake host stands in for the
 * popup) and the engine-line formatters. Only the HTTP edges and the DM model are stubbed.
 *
 * Fixtures follow their real producers:
 *   - the dying participant is `DYING_SCHOLAR_PARTICIPANT`, captured from
 *     `CombatEncounterService.getCombatState` (and pinned to it by `dying-and-death.real-db.test.ts`),
 *     read through the real `mapAuthoritativeCombat`;
 *   - the save result is the server's `HPMechanics.resolveDeathSave`, and the death_save intent
 *     result is shaped as `executeCombatIntent` returns it (`{ ...turn, deathSaves: [save] }`);
 *   - the enemy's blow on the body is `ENEMY_STRIKES_DOWNED_PLAYER`, `resolveAttack`'s output;
 *   - the intent body is `deathSaveIntentWire`, shared with the server's route test.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HPMechanics } from '../../../server-bun/src/services/combat/hp-mechanics';
import { buildNpcEngineMessage } from '../../../shared/npc-engine-message';
import {
  deathSaveIntentWire,
  deathSaveIntentWireAutoRolled,
} from '../../../shared/test-fixtures/death-save-intent';
import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../shared/test-fixtures/dying-participant-wire';
import { ENEMY_STRIKES_DOWNED_PLAYER } from '../../../shared/test-fixtures/engine-results';
import { useAIResponse } from '../use-ai-response';

import type { LocalNotice } from '@/hooks/ai/types';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { useCombat } from '@/contexts/CombatContext';
import { DYING_ACTION_REFUSED_NOTICE } from '@/hooks/ai/dying-turn';
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
    enterCombat: vi.fn(),
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

const SESSION_ID = 'd3d075ef-fec7-4442-b684-c5c35084f41e';
const SCHOLAR = DYING_SCHOLAR_PARTICIPANT;
const SPIDER_ID = '99999999-1111-4222-8333-444444444444';

/** The spider, as the server serves it: the same producer, a monster row with a standing status. */
const spiderWire = {
  ...SCHOLAR,
  id: SPIDER_ID,
  characterId: null,
  name: 'Vitruvian Spider',
  participantType: 'monster',
  turnOrder: 1,
  initiative: 10,
  maxHp: 40,
  monsterAttack: null,
  status: {
    ...SCHOLAR.status,
    id: 'spider-status',
    participantId: SPIDER_ID,
    currentHp: 40,
    maxHp: 40,
    isConscious: true,
    deathSavesFailures: 0,
  },
  vitalState: 'standing',
};

/** The board as `readAuthoritativeCombat` maps it: whose turn, and where the Scholar stands. */
const encounterAt = (holder: 'scholar' | 'spider', scholar: Record<string, unknown> = SCHOLAR) =>
  mapAuthoritativeCombat({
    encounter: {
      ...DYING_SCHOLAR_ENCOUNTER,
      sessionId: SESSION_ID,
      currentTurnOrder: holder === 'scholar' ? 0 : 1,
    },
    participants: [scholar, spiderWire] as any,
  } as any);

const SCHOLAR_SAVE = (roll: number) =>
  HPMechanics.resolveDeathSave(
    SCHOLAR.id,
    {
      currentHp: 0,
      maxHp: 7,
      tempHp: 0,
      isConscious: false,
      deathSavesSuccesses: SCHOLAR.status.deathSavesSuccesses,
      deathSavesFailures: SCHOLAR.status.deathSavesFailures,
    },
    roll,
  );

/** What `executeCombatIntent` returns for a death_save: the turn it advanced to, plus the save. */
const deathSaveIntentResult = (roll: number) => ({
  previousParticipant: null,
  currentParticipant: { id: SPIDER_ID, name: 'Vitruvian Spider' },
  newRound: false,
  roundNumber: 3,
  deathSaves: [SCHOLAR_SAVE(roll)],
});

/** `advance-npc-turns` after the save: the spider strikes the body, and the turn comes back. */
const spiderStrikesTheBody = {
  results: [
    {
      action: {
        actor_id: SPIDER_ID,
        action_type: 'attack',
        target_ids: [SCHOLAR.id],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      round: 3,
      outcomes: [],
      engineResult: {
        ...ENEMY_STRIKES_DOWNED_PLAYER,
        actorId: SPIDER_ID,
        actorName: 'Vitruvian Spider',
        targetId: SCHOLAR.id,
        targetName: 'The Scholar',
      },
      actorIsPlayer: false,
      transcriptLines: [],
    },
  ],
  currentParticipant: {
    id: SCHOLAR.id,
    name: 'The Scholar',
    participantType: 'player',
    vitalState: 'dying',
  },
  round: 4,
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};

/**
 * The spider's row as the server writes it: `buildNpcEngineMessage` over the runner's result, keyed
 * by the runner's actionId (`encounterId:round:actorId:actionType`).
 */
const spiderRow = (() => {
  const npcResult = spiderStrikesTheBody.results[0];
  const message = buildNpcEngineMessage(
    [
      { id: SCHOLAR.id, name: 'The Scholar', participantType: 'player', maxHp: 7 },
      { id: SPIDER_ID, name: 'Vitruvian Spider', participantType: 'monster', maxHp: 40 },
    ],
    npcResult.round,
    {
      type: npcResult.action.action_type,
      actorId: npcResult.action.actor_id,
      targetIds: npcResult.action.target_ids,
    },
    npcResult.engineResult,
  );
  const actionId = `enc-1:${npcResult.round}:${SPIDER_ID}:attack`;
  return {
    id: 'npc-row-spider-strike',
    sequence: 100,
    text: message.text,
    kind: 'npc',
    actionId,
    sessionId: SESSION_ID,
    timestamp: new Date().toISOString(),
    context: {
      ...message.context,
      npcResult: npcResult.engineResult,
      combatEncounterId: 'enc-1',
      actionId,
    },
  };
})();

describe('useAIResponse: the dying player’s turn (#2518)', () => {
  let order: string[];
  let intentBodies: Array<Record<string, any>>;
  let rollAnswer: { d20: number | null; cancelled?: boolean };

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    intentBodies = [];
    rollAnswer = { d20: 14 };

    // The dice popup: the death save prompt is answered with the die the player "rolled".
    setPlayerRollHost({
      present: (spec, settle) => {
        order.push('deathSave' in spec ? 'prompt: death save' : 'prompt: other');
        queueMicrotask(() => settle(rollAnswer));
        return { rollId: 'roll-death-save', dismiss: () => {} };
      },
    });

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: encounterAt('scholar') },
      refreshCombatState: vi.fn(async () => encounterAt('scholar')),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: SESSION_ID,
      campaign_id: 'camp-1',
      character_id: SCHOLAR.characterId,
      campaign: { id: 'camp-1' },
      character: { id: SCHOLAR.characterId, name: 'The Scholar' },
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    vi.mocked(AIService.chatWithDM).mockImplementation((async () => {
      order.push('narration');
      return { text: 'The spider’s fangs close on the body. The Scholar does not move.' };
    }) as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        intentBodies.push(body);
        order.push(`intent: ${body.intent?.type}`);
        // #2658 step 3: the intent route runs the creatures that now hold the turn before it
        // answers, so the save's response carries the spider's turn and its server-written row.
        const result = {
          ...deathSaveIntentResult(body.intent?.d20 ?? 11),
          npcTurns: { ...spiderStrikesTheBody, engineRows: [spiderRow] },
          engineRows: [spiderRow],
        };
        return new Response(JSON.stringify({ accepted: true, result, engineRows: [spiderRow] }), {
          status: 200,
        });
      }),
    );
  });

  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  const playDyingTurn = (onEngineNotice?: (notice: LocalNotice) => void) => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [
        {
          text: 'Death saving throw.',
          sender: 'player',
          timestamp: new Date().toISOString(),
          context: { intent: 'death_save_turn' },
        },
      ] as any,
      SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      onEngineNotice,
    );
  };

  // Migrated (#2658 step 3): was "asks the player for ONE d20 through the roll prompt, sends the save with that die, and ends the turn there"
  it('asks the player for ONE d20 through the roll prompt, sends the save with that die, and the creatures that follow come back on the same response', async () => {
    await playDyingTurn(() => {});

    // The prompt opens first and the player's die (14) is what the engine is handed — the exact
    // body the server's route test posts through the real schema.
    expect(order[0]).toBe('prompt: death save');
    expect(intentBodies).toHaveLength(1);
    const { dmStartedAt, ...sent } = intentBodies[0];
    expect(typeof dmStartedAt).toBe('number');
    expect(sent).toEqual(deathSaveIntentWire(SCHOLAR.id, 14));
    // No `end_turn`: the save is the whole turn and the server already moved the order on.
    expect(intentBodies.some((body) => body.intent?.type === 'end_turn')).toBe(false);
    // The monsters act BETWEEN saves, after this one, never inside it: the server ran them
    // before it answered the save, so the client makes no second request for them.
    expect(order).toEqual(['prompt: death save', 'intent: death_save', 'narration']);
  });

  it('prints the save and the strike on the body as engine lines with cards, under the player’s turn', async () => {
    // NPC results now arrive as server-delivered system message rows, not client-assembled
    // combatEngineBlocks. Capture the row dispatched via the session-engine-rows event.
    const npcRows: Array<{ text: string; context: any }> = [];
    const capture = (event: Event) => {
      npcRows.push(...((event as CustomEvent).detail as Array<{ text: string; context: any }>));
    };
    window.addEventListener('session-engine-rows', capture);
    try {
      const response = await playDyingTurn(() => {});

      // The player's death save is still a client-assembled block in the response context.
      const blocks = response.context?.combatEngineBlocks as Array<{
        source: string;
        lines: string[];
        cards?: Array<{ kind: string }>;
      }>;
      expect(blocks[0]).toMatchObject({ source: 'player' });
      expect(blocks[0].lines.join('\n')).toContain(
        'The Scholar rolled 14 on their death saving throw — SUCCESS (1 success, 2 failures).',
      );
      expect(blocks[0].cards?.[0]).toMatchObject({ kind: 'death_save' });
      // No NPC block in the response context anymore — the spider's strike arrives as a
      // server-delivered row.
      expect(blocks).toHaveLength(1);

      // The spider's strike on the body arrives as a server-delivered NPC row.
      expect(npcRows).toHaveLength(1);
      expect(npcRows[0].text).toContain(
        'Vitruvian Spider strikes the unconscious The Scholar — automatic critical hit. Two death-save failures. ✕✕○',
      );
      expect(npcRows[0].context).toMatchObject({
        intent: 'combat_npc_result',
        round: 3,
      });
      const npcBlock = (npcRows[0].context as any).combatEngineBlocks[0];
      expect(npcBlock).toMatchObject({ source: 'npc' });
      expect(npcBlock.lines.join('\n')).toContain(
        'Vitruvian Spider strikes the unconscious The Scholar — automatic critical hit. Two death-save failures. ✕✕○',
      );
    } finally {
      window.removeEventListener('session-engine-rows', capture);
    }
  });

  it('is narrated once, from the engine’s results, and does not hand a dying player the turn', async () => {
    const response = await playDyingTurn(() => {});

    // The DM is called ONCE: there is no declaration to write for a character who cannot act.
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    const asked = vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any;
    const payload = JSON.parse(asked.message);
    expect(payload.authoritativeCombatResults[0].engineFact).toContain(
      'rolled 14 on their death saving throw',
    );
    expect(JSON.stringify(payload.authoritativeCombatResults)).toContain('automatic critical hit');
    // The player is on the floor again: no "what do you do?", the narration is told why.
    expect(payload.turnHandoff).toContain('unconscious and dying');
    expect(payload.turnHandoff).not.toContain('what do you do?"');
    expect(response.text).not.toContain('what do you do?');
    // The DM's setup line says the turn was a death save, not an action it declared.
    expect(JSON.stringify(asked.conversationHistory)).toContain('death saving throw');
  });

  it('an unanswered prompt (45 s) or a dismissed one is rolled by the engine, and the line says so', async () => {
    rollAnswer = { d20: null };
    await playDyingTurn(() => {});

    const { dmStartedAt: _clock, ...sent } = intentBodies[0];
    expect(sent).toEqual(deathSaveIntentWireAutoRolled(SCHOLAR.id));
    const asked = vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any;
    expect(JSON.parse(asked.message).authoritativeCombatResults[0].autoRolled).toBe(true);
  });

  it('a dismissed prompt does not withdraw the save: a dying character cannot decline their turn', async () => {
    rollAnswer = { d20: null, cancelled: true };
    await playDyingTurn(() => {});

    expect(intentBodies).toHaveLength(1);
    expect(intentBodies[0].intent).toEqual({ type: 'death_save', actorId: SCHOLAR.id });
  });

  it('refuses a typed action for the dying player with the reason: no DM turn, no engine call', async () => {
    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(
      [
        {
          text: 'I attack the spider with my staff',
          sender: 'player',
          timestamp: new Date().toISOString(),
        },
      ] as any,
      SESSION_ID,
    );

    expect(response.localNotice).toBe(DYING_ACTION_REFUSED_NOTICE);
    expect(response.text).toBe('');
    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(intentBodies).toHaveLength(0);
    expect(order).toEqual([]);
  });

  /** The server's answer to the save that ENDED the fight: `markCombatEnded` adds the ending. */
  const endingResult = (
    save: ReturnType<typeof HPMechanics.resolveDeathSave>,
    ending: Record<string, unknown>,
  ) => ({
    previousParticipant: null,
    currentParticipant: { id: SPIDER_ID, name: 'Vitruvian Spider' },
    newRound: false,
    roundNumber: 3,
    deathSaves: [save],
    combatEnded: true,
    ...ending,
  });

  it('three successes with nobody left to fight: stable, the hours the engine rolled, and NO death screen', async () => {
    const stabilising = HPMechanics.resolveDeathSave(
      SCHOLAR.id,
      {
        currentHp: 0,
        maxHp: 7,
        tempHp: 0,
        isConscious: false,
        deathSavesSuccesses: 2,
        deathSavesFailures: 0,
      },
      13,
    );
    expect(stabilising.isStabilized).toBe(true);
    vi.mocked(fetch as any).mockImplementation(async (_url: string, init?: RequestInit) => {
      intentBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          result: endingResult(stabilising, {
            endedReason: 'player_down_stable',
            wake: [{ participantId: SCHOLAR.id, name: 'The Scholar', hours: 3 }],
          }),
        }),
        { status: 200 },
      );
    });
    // After the fight the hero is awake on 1 HP: the session reads as alive.
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: encounterAt('scholar') },
      refreshCombatState: vi
        .fn()
        .mockResolvedValueOnce(encounterAt('scholar'))
        .mockResolvedValue(null),
    } as any);

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(
      [
        {
          text: 'Death saving throw.',
          sender: 'player',
          timestamp: new Date().toISOString(),
          context: { intent: 'death_save_turn' },
        },
      ] as any,
      SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
    );

    const lines = (response.context?.combatEngineBlocks as Array<{ lines: string[] }>)
      .flatMap((block) => block.lines)
      .join('\n');
    expect(lines).toContain('the third success. The Scholar is stable.');
    expect(lines).toContain(
      'The Scholar is stable and unconscious for 3 hours (1d4). The Scholar wakes with 1 HP.',
    );
    // No NPC turn after a fight that is over (the save's answer carries none, and nothing else
    // is asked of the server), and the DM is asked once, for the aftermath.
    expect(intentBodies.map((body) => body.intent?.type)).toEqual(['death_save']);
    expect(response.context?.combatEngineBlocks).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'npc' })]),
    );
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    // A story beat, not a death: the end state does not replace the game.
    await waitFor(() => expect(result.current.terminalDeathState).toBeNull());
  });

  it('three failures: the DEAD line is printed, the screen comes from the resolution, and the killing round is narrated', async () => {
    const fatal = HPMechanics.resolveDeathSave(
      SCHOLAR.id,
      {
        currentHp: 0,
        maxHp: 7,
        tempHp: 0,
        isConscious: false,
        deathSavesSuccesses: 0,
        deathSavesFailures: 2,
      },
      4,
    );
    expect(fatal.isDead).toBe(true);
    vi.mocked(fetch as any).mockImplementation(async (_url: string, init?: RequestInit) => {
      intentBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({ result: endingResult(fatal, { endedReason: 'party_defeated' }) }),
        { status: 200 },
      );
    });
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue({
      characterId: SCHOLAR.characterId,
      characterName: 'The Scholar',
      campaignId: 'camp-1',
      campaignName: 'Abyssal Descent',
      starterCampaignId: null,
      diedAt: '2026-10-05T23:00:00.000Z',
    } as any);
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: encounterAt('scholar') },
      refreshCombatState: vi
        .fn()
        .mockResolvedValueOnce(encounterAt('scholar'))
        .mockResolvedValue(null),
    } as any);

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(
      [
        {
          text: 'Death saving throw.',
          sender: 'player',
          timestamp: new Date().toISOString(),
          context: { intent: 'death_save_turn' },
        },
      ] as any,
      SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
    );

    // The killing round gets its paragraph: the DM was asked, from the engine's results.
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    expect(response.text).toContain('The spider’s fangs close on the body.');
    const lines = (response.context?.combatEngineBlocks as Array<{ lines: string[] }>)
      .flatMap((block) => block.lines)
      .join('\n');
    expect(lines).toContain('the third failure. The Scholar is DEAD.');
    await waitFor(() =>
      expect(result.current.terminalDeathState).toMatchObject({ state: 'party_defeated' }),
    );
    expect(result.current.terminalDeathState?.finalLines?.join('\n')).toContain('is DEAD');
  });
});
