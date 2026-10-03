/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2530 — a DM roll request in combat, and the player's next turn.
 *
 * B2 (D1 turns 23 and C1): the model answered a typed attack with `roll_requests` and no
 * `combat_actions`. The zero-action guard and the silent-turn path both stood down because the turn
 * looked "paused on the dice popup", and `processRollRequests` then dropped the request because
 * combat never shows that popup. Nothing resolved, nothing was shown, and the saved row kept prose
 * with `rollRequests: []`.
 *
 * B1 regression: a declared melee attack (Fighter, longsword) and a sheet-cast attack reach the
 * d20 prompt inside the generate turn, and the 45 s auto-roll is not what settles them.
 *
 * Fixture producers: every DM envelope below is the output of the real `processDMResponse`
 * (`combat_transition: 'none'` and every array present, as production sends them, per #2349).
 * The proposal, intent and spell bodies follow `proposeAuthoritativeAttack`'s and
 * `proposeCombatSpell`'s own returns, as in `use-ai-response.ordinary-turn-engine-lines.test.ts`.
 * Everything from the hook down to the dice bridge is real; the HTTP edges and the model are stubbed.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import type { LocalNotice } from '@/hooks/ai/types';
import type { PlayerRollOutcome, PlayerRollSpec } from '@/services/combat/player-roll-bridge';

import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';
import {
  buildSpellCastContext,
  buildSpellCastMessage,
} from '@/features/game-session/components/game/overhaul/spell-view-model';
import logger from '@/lib/logger';
import { processDMResponse } from '@/services/ai/dm-response-processor';
import { AIService } from '@/services/ai-service';
import {
  hasPendingPlayerRoll,
  markNarrativeRollCommitted,
  PLAYER_ATTACK_ROLL_TIMEOUT_MS,
  requestPlayerAttackRoll,
  setPlayerRollHost,
} from '@/services/combat/player-roll-bridge';
import { rollStateManager } from '@/services/combat/rollStateManager';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
  getAccessToken: vi.fn(() => 'test'),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    detectDeclaredAttack: vi.fn(),
    advanceNpcTurns: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
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

const SESSION_ID = '0b0c1f3e-8d7e-4f55-9d2a-6a1c5d7b2e10';
const ENCOUNTER_ID = 'enc-2530';
const VETERAN = {
  id: 'c0ffee00-0000-4000-8000-000000000001',
  name: 'The Veteran',
  class: 'Fighter',
  currentHitPoints: 12,
  maxHitPoints: 12,
  abilityScores: { dexterity: { modifier: 1 } },
};
const participants = [
  {
    id: 'veteran-1',
    characterId: VETERAN.id,
    name: 'The Veteran',
    participantType: 'player',
    turnOrder: 0,
    initiative: 12,
    isActive: true,
  },
  {
    id: 'goblin-1',
    name: 'Goblin',
    participantType: 'npc',
    turnOrder: 1,
    initiative: 8,
    isActive: true,
  },
];
const encounter = {
  id: ENCOUNTER_ID,
  phase: 'active',
  currentTurnParticipantId: 'veteran-1',
  currentRound: 2,
  participants,
};
const noNpcTurns = {
  results: [],
  currentParticipant: { id: 'veteran-1', name: 'The Veteran', participantType: 'player' },
  combatEnded: false,
  iterationCount: 0,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};

const ATTACK_INPUT = 'I attack the goblin with my longsword';
const longswordAttack = {
  actor_id: 'veteran-1',
  action_type: 'attack',
  target_ids: ['goblin-1'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};
const attackRollRequest = {
  type: 'attack',
  formula: '1d20+6',
  purpose: 'Longsword attack on the goblin',
  ac: 15,
};

/** The DM's reply, run through the producer that builds every reply the hook sees. */
const dmEnvelope = (fields: Record<string, unknown>) =>
  processDMResponse({
    rawResponse: JSON.stringify({ text: 'You step in and swing.', ...fields }),
    context: { gameState: { isInCombat: true } } as any,
    message: ATTACK_INPUT,
    conversationHistory: [],
    voiceContext: null,
    isFirstMessage: false,
    deferSideEffects: true,
  });

describe('useAIResponse: DM roll requests and the player’s turn (#2530)', () => {
  let prompts: Array<{ spec: PlayerRollSpec; settle: (outcome: PlayerRollOutcome) => void }>;
  let intentBodies: Array<Record<string, any>>;
  let held: string;

  beforeEach(() => {
    vi.clearAllMocks();
    prompts = [];
    intentBodies = [];
    held = 'veteran-1';
    rollStateManager.clearAllState();

    vi.mocked(useGame).mockReturnValue({
      state: { currentPhase: 'combat', diceRollQueue: { pendingRolls: [] } },
      setGamePhase: vi.fn(),
      cancelDiceRoll: vi.fn(),
    } as any);
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: null },
      refreshCombatState: vi.fn(async () => ({ ...encounter, currentTurnParticipantId: held })),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: SESSION_ID,
      campaign_id: 'camp-1',
      character_id: VETERAN.id,
      campaign: { id: 'camp-1' },
      character: VETERAN,
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue(noNpcTurns as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.phase === 'propose' && body.intent?.type === 'spell') {
          // `proposeCombatSpell`'s whole return for a Fire Bolt cast by The Veteran at the Goblin.
          return new Response(
            JSON.stringify({
              accepted: true,
              proposal: {
                movementOnly: false,
                spellId: 'fire-bolt',
                spellName: 'Fire Bolt',
                kind: 'attack',
                attackBonus: 4,
                saveDC: 12,
                targetAc: 15,
                advantage: false,
                disadvantage: false,
                actorId: 'veteran-1',
                targetIds: ['goblin-1'],
                expectedVersion: 3,
                targetLabel: 'Goblin',
              },
            }),
            { status: 200 },
          );
        }
        if (body.intent?.type === 'spell') {
          intentBodies.push(body);
          return new Response(
            JSON.stringify({
              result: {
                results: [
                  {
                    actorName: 'The Veteran',
                    targetName: 'Goblin',
                    spellName: 'Fire Bolt',
                    d20: body.intent.d20 ?? 9,
                    attackBonus: 4,
                    totalAttackRoll: (body.intent.d20 ?? 9) + 4,
                    targetAC: 15,
                    hit: true,
                    finalDamage: 5,
                    damageType: 'fire',
                  },
                ],
              },
            }),
            { status: 200 },
          );
        }
        if (body.phase === 'propose') {
          return new Response(
            JSON.stringify({
              proposal: {
                movementOnly: false,
                legal: true,
                weaponName: 'Longsword',
                attackBonus: 6,
                targetAc: 15,
                advantage: false,
                disadvantage: false,
                targetLabel: 'Goblin',
              },
            }),
            { status: 200 },
          );
        }
        if (body.intent?.type === 'attack') {
          intentBodies.push(body);
          return new Response(
            JSON.stringify({
              result: {
                actorName: 'The Veteran',
                targetName: 'Goblin',
                d20: body.intent.d20 ?? 9,
                attackBonus: 6,
                totalAttackRoll: (body.intent.d20 ?? 9) + 6,
                targetAC: 15,
                hit: true,
                finalDamage: 7,
                damageType: 'slashing',
                targetNewHp: 0,
                targetCondition: 'near death',
                weaponResolution: { resolved: 'Longsword', substituted: false },
              },
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({ result: { currentParticipant: { id: 'goblin-1', name: 'Goblin' } } }),
          { status: 200 },
        );
      }),
    );
    // The player holds the die until the test says otherwise: the prompt must already be up.
    setPlayerRollHost({
      present: (spec, settle) => {
        prompts.push({ spec, settle });
        return { rollId: `roll-${prompts.length}`, dismiss: () => {} };
      },
    });
  });

  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  const play = (
    text: string,
    options: {
      onEngineNotice?: (notice: LocalNotice) => void;
      history?: Array<Record<string, unknown>>;
    } = {},
  ): ReturnType<ReturnType<typeof useAIResponse>['getAIResponse']> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [
        ...(options.history ?? []),
        { text, sender: 'player', timestamp: new Date().toISOString() },
      ] as any,
      SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      options.onEngineNotice,
    );
  };

  const repairCalls = (): any[] =>
    vi
      .mocked(AIService.chatWithDM)
      .mock.calls.filter((call) =>
        String((call[0] as any)?.message ?? '').includes('YOUR LAST RESPONSE RESOLVED NOTHING'),
      );

  describe('item 1: a roll request in combat is not silently dropped', () => {
    it('re-asks for the missing action, resolves it, and keeps no pending roll behind', async () => {
      vi.mocked(AIService.chatWithDM)
        // First pass: a roll request and no action, the shape that stood the guards down.
        .mockResolvedValueOnce(await dmEnvelope({ roll_requests: [attackRollRequest] }))
        // The repair: the same turn, declared properly.
        .mockResolvedValueOnce(
          await dmEnvelope({ text: 'You swing.', combat_actions: [longswordAttack] }),
        )
        // The narration of what the engine resolved.
        .mockResolvedValue(await dmEnvelope({ text: 'The goblin falls.' }));

      const turn = play(ATTACK_INPUT);
      await vi.waitFor(() => expect(prompts).toHaveLength(1));
      prompts[0].settle({ d20: 17 });
      const response = await turn;

      expect(repairCalls()).toHaveLength(1);
      expect(intentBodies).toHaveLength(1);
      expect(intentBodies[0].intent).toMatchObject({ type: 'attack', actorId: 'veteran-1' });
      // The request is gone from the row, and the log says what it was (type, not content).
      expect(response.rollRequests).toEqual([]);
      expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
        encounterId: ENCOUNTER_ID,
        type: 'attack',
        purpose: attackRollRequest.purpose,
      });
      // Nothing dangles: the engine's pending-roll tracking was never touched, and no bridge
      // prompt is left waiting.
      expect(rollStateManager.getPendingRolls()).toEqual([]);
      expect(hasPendingPlayerRoll()).toBe(false);
    });
  });

  describe('item 1, other request types', () => {
    it('drops a skill check asked for in combat, logs its type, and leaves the row without it', async () => {
      const check = { type: 'skill_check', formula: '1d20+3', purpose: 'Persuasion', dc: 12 };
      vi.mocked(AIService.chatWithDM)
        .mockResolvedValueOnce(await dmEnvelope({ text: 'He hesitates.', roll_requests: [check] }))
        .mockResolvedValue(await dmEnvelope({ text: 'He lowers his blade.' }));

      const response = await play('I try to talk the goblin down');

      expect(response.rollRequests).toEqual([]);
      expect(response.localNotices).toContainEqual({
        text: 'The DM asked for a skill check roll, but dice in combat belong to the engine, so no roll was made.',
        persist: true,
      });
      expect(prompts).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
        encounterId: ENCOUNTER_ID,
        type: 'skill_check',
        purpose: 'Persuasion',
      });
    });
  });

  describe('item 3: the attack prompt reaches the player inside the generate turn (B1)', () => {
    it('a declared melee attack (Fighter, longsword) is asked for, and the player’s die is the one used', async () => {
      vi.mocked(AIService.chatWithDM)
        .mockResolvedValueOnce(
          await dmEnvelope({ text: 'You swing.', combat_actions: [longswordAttack] }),
        )
        .mockResolvedValue(await dmEnvelope({ text: 'The goblin falls.' }));

      const turn = play(ATTACK_INPUT);
      // The prompt is up while the turn is still open, long before any timer could fire.
      await vi.waitFor(() => expect(prompts).toHaveLength(1));
      expect(prompts[0].spec).toMatchObject({
        weaponName: 'Longsword',
        targetLabel: 'Goblin',
        attackBonus: 6,
        targetAc: 15,
      });
      expect(hasPendingPlayerRoll()).toBe(true);
      expect(intentBodies).toHaveLength(0);

      prompts[0].settle({ d20: 17 });
      await turn;

      expect(intentBodies).toHaveLength(1);
      expect(intentBodies[0].intent.d20).toBe(17);
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining(`timed out after ${PLAYER_ATTACK_ROLL_TIMEOUT_MS}ms`),
      );
      expect(hasPendingPlayerRoll()).toBe(false);
    });

    it('a sheet-cast attack spell is asked for in the same turn, and the player’s die is the one used', async () => {
      const fireBolt = {
        actor_id: 'veteran-1',
        action_type: 'cast_spell',
        target_ids: ['goblin-1'],
        weapon_id: null,
        spell_id: 'fire-bolt',
        slot_level: null,
        movement_feet: 0,
      };
      vi.mocked(AIService.chatWithDM)
        .mockResolvedValueOnce(await dmEnvelope({ text: 'You cast.', combat_actions: [fireBolt] }))
        .mockResolvedValue(await dmEnvelope({ text: 'Fire takes the goblin.' }));
      const { result } = renderHook(() => useAIResponse());

      const turn = result.current.getAIResponse(
        [
          {
            text: buildSpellCastMessage({ name: 'Fire Bolt', id: 'fire-bolt', level: 0 }),
            sender: 'player',
            timestamp: new Date().toISOString(),
            context: buildSpellCastContext({ id: 'fire-bolt', level: 0 }),
          },
        ] as any,
        SESSION_ID,
      );
      await vi.waitFor(() => expect(prompts).toHaveLength(1));
      expect(prompts[0].spec).toMatchObject({
        kind: 'spell-attack',
        weaponName: 'Fire Bolt',
        attackBonus: 4,
        targetAc: 15,
      });
      expect(hasPendingPlayerRoll()).toBe(true);

      prompts[0].settle({ d20: 15 });
      await turn;

      expect(intentBodies).toHaveLength(1);
      expect(intentBodies[0].intent).toMatchObject({ type: 'spell', d20: 15 });
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining(`timed out after ${PLAYER_ATTACK_ROLL_TIMEOUT_MS}ms`),
      );
    });

    it('two attacks while the first narration is still pending each get their own prompt (run 19 T7)', async () => {
      let releaseFirstNarration!: (value: unknown) => void;
      vi.mocked(AIService.chatWithDM)
        // Turn 1: declaration, then a narration that does not come back until released.
        .mockResolvedValueOnce(
          await dmEnvelope({ text: 'You swing.', combat_actions: [longswordAttack] }),
        )
        .mockImplementationOnce(() => new Promise((resolve) => (releaseFirstNarration = resolve)))
        // Turn 2: declaration, then its narration.
        .mockResolvedValueOnce(
          await dmEnvelope({ text: 'You swing again.', combat_actions: [longswordAttack] }),
        )
        .mockResolvedValue(await dmEnvelope({ text: 'Again it staggers.' }));

      const first = play(ATTACK_INPUT);
      await vi.waitFor(() => expect(prompts).toHaveLength(1));
      prompts[0].settle({ d20: 12 });
      await vi.waitFor(() => expect(releaseFirstNarration).toBeDefined());

      // The first narration is still pending; the player attacks again.
      const second = play('I attack the goblin again');
      await vi.waitFor(() => expect(prompts).toHaveLength(2));
      expect(prompts[1].spec).toMatchObject({ weaponName: 'Longsword' });
      prompts[1].settle({ d20: 4 });

      releaseFirstNarration(await dmEnvelope({ text: 'The goblin reels.' }));
      await Promise.all([first, second]);

      expect(intentBodies.map((body) => body.intent.d20)).toEqual([12, 4]);
      expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('superseded'));
    });
  });
  describe('item 2: the next turn never waits silently', () => {
    const plainNarration = (): Promise<any> => dmEnvelope({ text: 'The goblin snarls.' });
    // Outside combat a turn is one DM call, so the call count below is the turn count.
    const noCombat = (): void => {
      vi.mocked(useCombat).mockReturnValue({
        state: { isInCombat: false, activeEncounter: null },
        refreshCombatState: vi.fn(async () => null),
      } as any);
    };

    it('answers the same words typed twice once the message window is full (D1 turn 23)', async () => {
      noCombat();
      vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
      const { result } = renderHook(() => useAIResponse());
      // The loaded window is capped at PAGE_SIZE rows, so `messages.length` is identical on every
      // turn past the cap while the rows themselves slide.
      const windowEndingAt = (last: number): Array<Record<string, unknown>> =>
        Array.from({ length: 49 }, (_, index) => ({
          id: `row-${last - 48 + index}`,
          text: 'earlier',
          sender: 'dm',
          timestamp: `2026-10-02T12:${String(index).padStart(2, '0')}:00.000Z`,
        }));
      const turn = (last: number): ReturnType<typeof result.current.getAIResponse> =>
        result.current.getAIResponse(
          [
            ...windowEndingAt(last),
            { text: ATTACK_INPUT, sender: 'player', timestamp: new Date().toISOString() },
          ] as any,
          SESSION_ID,
        );

      await turn(52);
      const second = await turn(54);

      expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
      expect(second.text).not.toBe('');
      expect(logger.warn).not.toHaveBeenCalledWith(
        'DUPLICATE_PLAYER_TURN_SKIPPED',
        expect.anything(),
      );
    });

    it('still skips the identical turn arriving twice', async () => {
      noCombat();
      vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
      const { result } = renderHook(() => useAIResponse());
      const messages = [
        { id: 'row-1', text: 'earlier', sender: 'dm', timestamp: '2026-10-02T12:00:00.000Z' },
        { text: ATTACK_INPUT, sender: 'player', timestamp: '2026-10-02T12:01:00.000Z' },
      ] as any;

      await result.current.getAIResponse(messages, SESSION_ID);
      const repeat = await result.current.getAIResponse(messages, SESSION_ID);

      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect(repeat.text).toBe('');
      expect(logger.warn).toHaveBeenCalledWith('DUPLICATE_PLAYER_TURN_SKIPPED', {
        sessionId: SESSION_ID,
        messageCount: 2,
      });
    });

    it('rolls a combat die the player walked away from, says so, and goes on to the DM', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
      const abandoned = requestPlayerAttackRoll({
        actorLabel: 'The Veteran',
        targetLabel: 'Goblin',
        weaponName: 'Longsword',
        attackBonus: 6,
        targetAc: 15,
        advantage: false,
        disadvantage: false,
      });
      expect(hasPendingPlayerRoll()).toBe(true);
      const notices: LocalNotice[] = [];

      const response = await play('I look for another way out', {
        onEngineNotice: (notice) => notices.push(notice),
      });

      expect(await abandoned).toEqual({ d20: null });
      expect(notices).toEqual([
        {
          text: 'Your attack Longsword roll was rolled for you because you took another action.',
          persist: true,
        },
      ]);
      expect(AIService.chatWithDM).toHaveBeenCalled();
      expect(response.text).not.toBe('');
      expect(hasPendingPlayerRoll()).toBe(false);
    });

    describe('a narrative roll the DM asked for and the player has not answered', () => {
      const skillCheck = {
        id: 'queued-1',
        requestType: 'skill_check',
        description: 'Perception check to spot the tripwire',
        status: 'pending',
        rollConfig: { dieType: 20, count: 1, modifier: 3 },
      };
      const cancelDiceRoll = vi.fn();

      beforeEach(() => {
        cancelDiceRoll.mockReset();
        vi.mocked(useGame).mockReturnValue({
          state: {
            currentPhase: 'combat',
            diceRollQueue: {
              pendingRolls: [
                skillCheck,
                { ...skillCheck, id: 'queued-done', status: 'completed' },
                { ...skillCheck, id: 'engine-owned', combatAttackRoll: true },
              ],
            },
          },
          setGamePhase: vi.fn(),
          cancelDiceRoll,
        } as any);
        held = 'veteran-1';
      });

      it('is cancelled with a visible notice when the player takes another action', async () => {
        vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
        const notices: LocalNotice[] = [];

        await play('I back away from the door', {
          onEngineNotice: (notice) => notices.push(notice),
        });

        expect(cancelDiceRoll).toHaveBeenCalledTimes(1);
        expect(cancelDiceRoll).toHaveBeenCalledWith('queued-1');
        expect(notices).toEqual([
          {
            text: 'Your Perception check to spot the tripwire roll was set aside because you took another action.',
            persist: true,
          },
        ]);
        expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_CANCELLED', {
          reason: 'superseded_by_player_action',
          type: 'skill_check',
        });
        expect(AIService.chatWithDM).toHaveBeenCalled();
      });

      it('is left alone when the message is the roll’s own answer', async () => {
        vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
        const { result } = renderHook(() => useAIResponse());

        await result.current.getAIResponse(
          [
            {
              text: 'Perception check: 17',
              sender: 'player',
              timestamp: new Date().toISOString(),
              context: { intent: 'dice_roll', diceRoll: { total: 17 } },
            },
          ] as any,
          SESSION_ID,
        );

        expect(cancelDiceRoll).not.toHaveBeenCalled();
      });

      it('is left alone when the turn is a retry of one the player already sent', async () => {
        vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
        const { result } = renderHook(() => useAIResponse());

        await result.current.getAIResponse(
          [
            {
              text: 'I back away from the door',
              sender: 'player',
              timestamp: new Date().toISOString(),
              context: { intent: 'resume_unanswered' },
            },
          ] as any,
          SESSION_ID,
        );

        expect(cancelDiceRoll).not.toHaveBeenCalled();
      });

      it('is left alone once the player has pressed Roll, while the popup is still animating', async () => {
        vi.mocked(AIService.chatWithDM).mockResolvedValue(await plainNarration());
        markNarrativeRollCommitted('queued-1');

        await play('I back away from the door', { onEngineNotice: vi.fn() });

        expect(cancelDiceRoll).not.toHaveBeenCalled();
      });
    });
  });
});
