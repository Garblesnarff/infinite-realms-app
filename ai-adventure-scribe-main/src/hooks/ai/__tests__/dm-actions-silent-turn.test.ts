import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';
import { NEUTRAL_NO_EFFECT_LINE } from '../narration-gate';
import {
  SILENT_PLAYER_TURN_NOTE,
  SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES,
} from '../silent-player-turn';

import { buildSpellCastMessage } from '@/features/game-session/components/game/overhaul/spell-view-model';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

/**
 * Run M8 round 3 (#2342): "I try to talk the elemental down." The engine had nothing to resolve,
 * the DM's first-pass prose narrated a spell hit and a wound, and HP never moved.
 *
 * The handler, the resolution step and the notice are real; only the DM and the network edge are
 * stubbed. Nothing here swallows a throw: a handler that crashes fails the test that hit it.
 */

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    advanceNpcTurns: vi.fn(),
  },
}));

type HandlerParams = Parameters<typeof handleDmActionsAndTransitions>[0];
type Outcome = Awaited<ReturnType<typeof handleDmActionsAndTransitions>>;

const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const ELEMENTAL_ID = '779792b2-aef0-4288-be43-19aba2530eba';
const PARTICIPANTS = [
  { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player', turnOrder: 1 },
  { id: ELEMENTAL_ID, name: 'Spore Elemental', participantType: 'monster', turnOrder: 2 },
];
const ENCOUNTER = {
  id: 'encounter-m8',
  phase: 'active',
  participants: PARTICIPANTS,
  currentRound: 3,
  currentTurnParticipantId: APPRENTICE_ID,
};
const PLAYER_TURN = { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player' };
const HANDOFF = 'The Apprentice, what do you do?';
const NOTICE = '*(That was not a combat action — nothing was rolled. It is still your turn.)*';
const NOTICE_WITH_ENGINE_LINES = '*(You took no combat action this turn. It is still your turn.)*';

const TALK = 'I try to talk the elemental down.';
/** Round 3's first-pass prose: a spell nobody cast and a wound nobody took. */
const FABRICATED =
  'Your spell connects with the shimmering spore-creature, and it retaliates with a viscous ' +
  'lash that strikes you hard. You are wounded and reeling.';
/** Run M9, round 3 (#2373): DM message 16, verbatim. No engine line, HP 4/7 before and after. */
const M9_FABRICATED =
  'Your attempt to bridge the divide with words falls flat as the pulsating shard remains ' +
  'entirely unresponsive, its erratic energy ignoring your plea completely. As you speak, you ' +
  'narrowly avoid a strike from the entity, though a glancing blow still leaves you feeling ' +
  'rattled and wounded.';
const HONEST =
  'The Apprentice raises open hands and speaks softly. The elemental pauses, spores drifting, ' +
  'and its glow flickers as it listens.';
const NPC_LINE = '⚙️ Engine: Spore Elemental hits The Apprentice for 3 damage.';

const DODGE = {
  actor_id: 'the-apprentice',
  action_type: 'dodge',
  target_ids: [],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/**
 * The envelope `processDMResponse` produces on every reply: each array present, the transition
 * the string 'none', never absent (#2373). Fixtures that leave these out are how #2349 shipped a
 * predicate that never held in production.
 */
const PROD_RESULT = {
  combat_actions: [],
  roll_requests: [],
  combat_transition: 'none',
  map_actions: [],
  handout_actions: [],
};

const invoke = (overrides: Record<string, unknown> = {}): Promise<Outcome> => {
  const { result: resultOverrides, ...rest } = overrides;
  return handleDmActionsAndTransitions({
    sessionId: 'session-m8',
    characterRecord: { id: 'char-1' },
    activeEncounter: ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ENCOUNTER),
    aiContext: { gameState: {} },
    conversationHistory: [],
    playerMessage: TALK,
    playerInputOrigin: 'typed',
    result: { ...PROD_RESULT, text: FABRICATED, ...(resultOverrides as object) },
    ...rest,
  } as HandlerParams);
};

const narrationCall = (): { payload: Record<string, unknown>; setup: string } => {
  const calls = vi.mocked(AIService.chatWithDM).mock.calls;
  const [params] = calls[calls.length - 1];
  const history = params.conversationHistory ?? [];
  return { payload: JSON.parse(params.message), setup: history[history.length - 1].content };
};

/** Every DM call whose payload carried the silent-turn note. */
const noteCalls = (): string[] =>
  vi
    .mocked(AIService.chatWithDM)
    .mock.calls.map(([params]) => params.message)
    .filter((message) => message.includes('silentPlayerTurnNote'));

/** A pre-flight that resolved one NPC attack before the player's message reached the DM. */
const PREFLIGHT_NPC_ATTACK = {
  results: [
    {
      action: {
        actor_id: ELEMENTAL_ID,
        action_type: 'attack',
        target_ids: [APPRENTICE_ID],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      engineResult: undefined,
      transcriptLines: [NPC_LINE],
    },
  ],
  currentParticipant: PLAYER_TURN,
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};

describe('a combat turn the engine had no line for (#2342)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIService.lastRequestId).mockReturnValue('req-m8-r3');
    vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: HONEST } as never);
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      boundary: 'none',
      outcomes: [],
      result: undefined,
    } as never);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: ELEMENTAL_ID, name: 'Spore Elemental' },
    } as never);
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({ ok: true } as never);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [],
      transcriptLines: [],
      capReached: false,
      combatEnded: false,
      currentParticipant: { id: ELEMENTAL_ID, name: 'Spore Elemental' },
    } as never);
  });

  it('sends the DM the note, the player’s words, and no first-pass prose', async () => {
    await invoke();

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    const { payload, setup } = narrationCall();
    expect(payload.silentPlayerTurnNote).toBe(SILENT_PLAYER_TURN_NOTE);
    expect(payload.playerAttempt).toBe(TALK);
    expect(payload.authoritativeCombatResults).toEqual([]);
    expect(payload.currentTurn).toBe('The Apprentice');
    expect(payload.turnHandoff).toContain(HANDOFF);
    expect(setup).not.toContain('Your spell connects');
    expect(setup).toContain("still the player's turn");
    expect(userDataApi.advanceNpcTurns).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
  });

  it('replaces the fabricated prose and keeps the turn open in one line', async () => {
    const outcome = await invoke();

    expect(outcome.responseText).not.toMatch(/spell|wound/i);
    expect(outcome.responseText).toBe(`${HONEST}\n\n${NOTICE}\n\n${HANDOFF}`);
    expect(outcome.result.combatEngineBlocks).toEqual([]);
  });

  it('runs on the envelope production sends: combat_transition is "none", not absent (#2373)', async () => {
    // processDMResponse writes `combat_transition: transition || 'none'` on every reply, so the
    // predicate that read "no transition" as a falsy field never held in prod (run M9, R3).
    const outcome = await invoke({
      result: { text: FABRICATED, combat_actions: [], combat_transition: 'none' },
    });

    expect(noteCalls()).toHaveLength(1);
    expect(outcome.responseText).toBe(`${HONEST}\n\n${NOTICE}\n\n${HANDOFF}`);
  });

  it('does not double the handoff when the DM already ended with it', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: `${HONEST}\n\n${HANDOFF}` } as never);

    const outcome = await invoke();

    expect(outcome.responseText).toBe(`${HONEST}\n\n${NOTICE}\n\n${HANDOFF}`);
    expect(outcome.responseText.split(HANDOFF)).toHaveLength(2);
  });

  // #2349 logged this and let it through ("Log-only: no retry, and the turn is not blocked").
  // #2373 makes it a rule: the reply is rejected, asked for again, then replaced.
  it('rejects a reply that still narrates a hit: asks once more, then says nothing happened', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: FABRICATED,
      narrationSegments: [{ type: 'narration', text: FABRICATED }],
    } as never);

    const outcome = await invoke();

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    expect(outcome.responseText).toBe(`${NEUTRAL_NO_EFFECT_LINE}\n\n${NOTICE}\n\n${HANDOFF}`);
    expect(outcome.responseText).not.toContain(FABRICATED);
    // The voice segments carried the same words; they go with them.
    expect(outcome.narrationSegments).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_REJECTED',
      expect.objectContaining({
        reason: 'harm_claim_without_engine_event',
        sessionId: 'session-m8',
        requestId: 'req-m8-r3',
        branch: 'combat',
        encounterId: 'encounter-m8',
        attempt: 1,
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_REJECTED',
      expect.objectContaining({ attempt: 2 }),
    );
  });

  it('rejects the M9 parley narration, names the violation, and keeps the clean retry', async () => {
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({ text: M9_FABRICATED } as never)
      .mockResolvedValueOnce({ text: HONEST } as never);

    const outcome = await invoke({
      playerMessage: 'I try to talk it down.',
      result: { text: M9_FABRICATED, combat_actions: [], combat_transition: 'none' },
    });

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    const calls = vi.mocked(AIService.chatWithDM).mock.calls;
    expect(JSON.parse(calls[0][0].message)).not.toHaveProperty('narrationViolation');
    expect(calls[0][0].narrationViolation).toBeUndefined();
    const retry = JSON.parse(calls[1][0].message);
    expect(retry.silentPlayerTurnNote).toBe(SILENT_PLAYER_TURN_NOTE);
    // #2426 item 5: the note rides the prompt-rules param. `message` is what memory extraction
    // reads, so it must hold none of the violation text.
    expect(calls[1][0].narrationViolation).toContain('strike from the entity');
    expect(calls[1][0].narrationViolation).toContain('feeling rattled and wounded');
    expect(retry).not.toHaveProperty('narrationViolation');
    expect(calls[1][0].message).not.toContain('strike from the entity');
    expect(calls[1][0].message).not.toContain('feeling rattled and wounded');
    expect(calls[1][0].message).not.toContain(calls[1][0].narrationViolation);
    expect(outcome.responseText).toBe(`${HONEST}\n\n${NOTICE}\n\n${HANDOFF}`);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_REJECTED',
      expect.objectContaining({ attempt: 1, branch: 'combat' }),
    );
  });

  it('fails closed when the second ask throws: the claim is not shipped', async () => {
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({ text: M9_FABRICATED } as never)
      .mockRejectedValueOnce(new Error('upstream 503'));

    const outcome = await invoke();

    expect(outcome.responseText).toBe(`${NEUTRAL_NO_EFFECT_LINE}\n\n${NOTICE}\n\n${HANDOFF}`);
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NARRATION_REJECTED',
      expect.objectContaining({ attempt: 2, reason: 'regeneration_failed' }),
    );
  });

  it('passes a clean reply, or one that only denies the outcome, with one DM call each', async () => {
    await invoke();
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'Nothing lands: no spell, no hit, no damage. The elemental only listens.',
    } as never);
    await invoke();

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
  });

  describe('a rejected reply writes nothing (#2373)', () => {
    const held = (): { heldSideEffects: ReturnType<typeof vi.fn> } => ({
      heldSideEffects: vi.fn().mockResolvedValue(undefined),
    });

    it('parks the narration’s memory writes, and runs only the reply it keeps', async () => {
      const rejected = held();
      const kept = held();
      vi.mocked(AIService.chatWithDM)
        .mockResolvedValueOnce({ text: M9_FABRICATED, ...rejected } as never)
        .mockResolvedValueOnce({ text: HONEST, ...kept } as never);

      await invoke();

      for (const [params] of vi.mocked(AIService.chatWithDM).mock.calls) {
        expect(params.holdSideEffects).toBe(true);
      }
      expect(rejected.heldSideEffects).not.toHaveBeenCalled();
      expect(kept.heldSideEffects).toHaveBeenCalledTimes(1);
    });

    it('writes nothing for either reply when both claim harm', async () => {
      const first = held();
      const second = held();
      vi.mocked(AIService.chatWithDM)
        .mockResolvedValueOnce({ text: M9_FABRICATED, ...first } as never)
        .mockResolvedValueOnce({ text: M9_FABRICATED, ...second } as never);

      const outcome = await invoke();

      expect(outcome.responseText).toContain(NEUTRAL_NO_EFFECT_LINE);
      expect(first.heldSideEffects).not.toHaveBeenCalled();
      expect(second.heldSideEffects).not.toHaveBeenCalled();
    });

    it('runs a clean first reply’s writes', async () => {
      const first = held();
      vi.mocked(AIService.chatWithDM).mockResolvedValueOnce({ text: HONEST, ...first } as never);

      await invoke();

      expect(first.heldSideEffects).toHaveBeenCalledTimes(1);
    });
  });

  describe('with an NPC attack resolved in the pre-flight', () => {
    it('scopes the note to the player’s action and leaves the engine line standing', async () => {
      const outcome = await invoke({ preflightNpcTurns: PREFLIGHT_NPC_ATTACK });

      const { payload } = narrationCall();
      expect(payload.silentPlayerTurnNote).toBe(SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES);
      expect(payload.silentPlayerTurnNote).not.toMatch(/no damage was dealt or taken/i);
      expect(payload.authoritativeCombatResults).toHaveLength(1);
      expect(outcome.responseText).toContain(NPC_LINE);
      expect(outcome.responseText).toContain(NOTICE_WITH_ENGINE_LINES);
      expect(outcome.responseText).not.toContain('nothing was rolled');
      expect(outcome.responseText.trimEnd().endsWith(HANDOFF)).toBe(true);
    });

    it('does not gate a pass whose NPC lines are already on screen (#2388)', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValue({
        text: 'The elemental lashes out and hits you as you speak.',
      } as never);

      const outcome = await invoke({
        preflightNpcTurns: PREFLIGHT_NPC_ATTACK,
        npcLinesShown: true,
        onEngineNotice: vi.fn(),
      });

      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect(vi.mocked(AIService.chatWithDM).mock.calls[0][0]).not.toHaveProperty(
        'holdSideEffects',
      );
      expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
      expect(outcome.responseText).toContain('hits you as you speak');
    });

    it('does not gate the DM’s account of a pre-flight hit that ended the fight', async () => {
      const account = 'The elemental’s last lash strikes you down as the fight ends.';
      vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: account } as never);

      const outcome = await invoke({
        preflightNpcTurns: { ...PREFLIGHT_NPC_ATTACK, combatEnded: true },
        result: { text: account },
      });

      expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
      expect(outcome.responseText).toContain(account);
      expect(outcome.responseText).not.toContain(NEUTRAL_NO_EFFECT_LINE);
    });

    it('does not flag the NPC’s own hit as a fabrication', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValue({
        text: 'The elemental lashes out and hits you as you speak.',
      } as never);

      const outcome = await invoke({ preflightNpcTurns: PREFLIGHT_NPC_ATTACK });

      expect(logger.info).not.toHaveBeenCalledWith('DM_FABRICATION_SUSPECT', expect.anything());
      // The engine has a line for this turn, so the gate is not consulted and nobody is re-asked.
      expect(logger.warn).not.toHaveBeenCalledWith('DM_NARRATION_REJECTED', expect.anything());
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect(outcome.responseText).toContain('hits you as you speak');
    });
  });

  describe('stands down', () => {
    it.each([
      ['a dice result', { isDiceRollMessage: true, playerInputOrigin: 'dice_roll' }],
      ['an action-bar click', { playerInputOrigin: 'action_bar' }],
      ['a turn no player message started', { playerInputOrigin: null }],
      [
        'the legacy roll block',
        {
          result: { text: `${FABRICATED}\n\`\`\`ROLL_REQUESTS_V1\n[]\n\`\`\``, combat_actions: [] },
        },
      ],
      ['out of combat', { isInCombat: false, activeEncounter: null }],
    ])('for %s: the DM is never asked again and its text stands', async (_label, overrides) => {
      const outcome = await invoke(overrides);

      expect(AIService.chatWithDM).not.toHaveBeenCalled();
      expect(outcome.responseText).toContain('Your spell connects');
      expect(outcome.responseText).not.toContain('still your turn');
    });

    // A roll request used to stand this turn down as "paused on the dice popup". In combat the
    // popup never opens: `processRollRequests` drops every DM roll request while an encounter
    // is open, so the stand-down left a turn with no engine line, no prompt and prose that
    // described a wound nobody took (#2530). The request is dropped first, and the turn is silent.
    it('for a DM roll request in combat: it is dropped, so the turn is silent and the DM is asked again', async () => {
      const outcome = await invoke({
        result: {
          text: FABRICATED,
          roll_requests: [{ type: 'skill_check', formula: '1d20+3', purpose: 'Persuasion' }],
        },
      });

      expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
        encounterId: ENCOUNTER.id,
        type: 'skill_check',
        purpose: 'Persuasion',
      });
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect(outcome.responseText).toContain(NOTICE);
      expect(outcome.result.roll_requests ?? []).toEqual([]);
      expect(outcome.localNotices).toEqual([
        {
          text: 'The DM asked for a skill check roll, but dice in combat belong to the engine, so no roll was made.',
          persist: true,
        },
      ]);
    });

    it('for a combat transition: the board is re-read and no note is sent', async () => {
      const outcome = await invoke({
        result: { text: FABRICATED, combat_actions: [], combat_transition: 'end' },
      });

      expect(userDataApi.endTacticalMap).toHaveBeenCalledWith('session-m8');
      expect(noteCalls()).toEqual([]);
      expect(outcome.responseText).toContain('Your spell connects');
    });

    it('for a declared action: the engine runs it and no note is sent', async () => {
      await invoke({ result: { text: FABRICATED, combat_actions: [DODGE] } });

      expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
      expect(noteCalls()).toEqual([]);
    });

    it('for a sheet-declared spell: the engine says it did not happen, not the silent note', async () => {
      await invoke({
        playerMessage: buildSpellCastMessage({
          name: 'Burning Hands',
          id: 'burning-hands',
          level: 1,
        }),
      });

      expect(noteCalls()).toEqual([]);
      const { payload } = narrationCall();
      expect(payload.refusedActions).toEqual([
        expect.objectContaining({ refusalReason: 'PLAYER_SPELL_NOT_DECLARED' }),
      ]);
    });

    it('for a typed attack the DM never declared: it is an unresolved attack, not a non-action', async () => {
      // The zero-action guard asks once for the missing action and gets prose again.
      const outcome = await invoke({ playerMessage: 'I attack the elemental with my staff.' });

      expect(noteCalls()).toEqual([]);
      expect(outcome.responseText).toContain('Your spell connects');
      expect(outcome.responseText).not.toContain('That was not a combat action');
    });

    it('for a typed attack answered only with an NPC action: the NPC action is dropped, no note', async () => {
      const outcome = await invoke({
        playerMessage: 'I attack the elemental with my staff.',
        result: {
          text: FABRICATED,
          combat_actions: [{ ...DODGE, actor_id: 'spore-elemental' }],
        },
      });

      expect(noteCalls()).toEqual([]);
      expect(outcome.responseText).not.toContain('That was not a combat action');
    });
  });
});
