/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';
import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';

import {
  ACTION_MISSING_DESTINATION_REASON,
  ACTION_MISSING_TARGET_REASON,
  ACTION_NOT_SUPPORTED_REASON,
  HIDE_CHECK_UNROUTABLE_REASON,
} from '@/services/combat/combat-action-executor';

/**
 * A declared action the engine cannot execute as-is must refuse, not settle. An attack
 * with no target, a move with no destination, and a DM-declared hide the engine will not
 * take as a Stealth check all used to fall through the executor's catch-all `else` into
 * an empty success — which the resolution step settled exactly like an executed action:
 * `end_turn` was posted and NPC turns advanced, and the DM narrated an outcome that
 * never happened. That silent settle is what these tests pin shut:
 *
 *   1. No `end_turn` intent is posted for the refused actor.
 *   2. No creature runs either: the server runs NPC turns only behind an accepted End turn
 *      (#2658 step 3), and none is sent.
 *   3. The refusal reaches the narration pass named as a refusal, and the reply the
 *      player reads names what was missing and says it is still their turn.
 *   4. No repair is spent on it: the player re-declares, the DM does not get a second
 *      LLM pass at a declaration it already malformed.
 *
 * The DM-declared hide is routed to the check intent with checkKind 'hide' (#2603 gave
 * it an engine owner); the hide case here stubs that route as refused, which is when
 * the executor's fallback refusal fires.
 */

const chatWithDM = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const askPlayerForAttackDie = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: (...args: any[]) => repairRefusedCombatAction(...args),
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  // The real module, error class and reason constants included. Only the intent POST is
  // stubbed (it would fetch); `executeStructuredCombatActionWithBoundary` itself stays
  // real, so the executor-to-resolution chain runs end to end and a change to the
  // refusal's shape fails here rather than against a hand-built look-alike.
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  // `isPlayerActor` stays real — telling the player's actions apart is the thing under test.
  ...(await importOriginal<typeof PlayerAttackRoll>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

/**
 * Every End turn this layer sent, through the stubbed intent POST or the real one (fetch): the
 * one request behind which the server runs NPC turns.
 */
const endTurnIntents = () => [
  ...executeAuthoritativeCombatIntent.mock.calls.filter(
    ([, intent]: any[]) => intent?.type === 'end_turn',
  ),
  ...fetchMock.mock.calls.filter(([, init]: any[]) =>
    String(init?.body ?? '').includes('"type":"end_turn"'),
  ),
];

const PLAYER_ID = '8eeac28d-0000-4000-8000-000000000001';
const NPC_ID = 'b962bd05-0000-4000-8000-000000000002';

const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
  { id: NPC_ID, name: 'Balthazar', participantType: 'monster' },
];

// The shape the DM's declaration path really sends: the full declared-action record with
// the fields the DM failed to fill left absent or empty (x/y are optional on the wire).
const malformedAction = (actorId: string, actionType: string): any => ({
  actor_id: actorId,
  action_type: actionType,
  target_ids: [],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

const resolutionPayload = () => JSON.parse(chatWithDM.mock.calls[0][0].message);

const run = (combatActions: any[], overrides: Record<string, unknown> = {}) =>
  resolveDeclaredCombatActions({
    encounterId: '10444307-0000-4000-8000-000000000003',
    combatActions,
    declarationText: 'The Reveler swings at nothing in particular.',
    participants: PARTICIPANTS,
    aiContext: { sessionId: 'session-2606', gameState: { isInCombat: true } },
    conversationHistory: [],
    ...overrides,
  });

const EXPECTED = {
  attack: {
    message: 'No target named — pick a target or type who you attack.',
    reason: ACTION_MISSING_TARGET_REASON,
  },
  move: {
    message: 'No destination — pick a square on the map.',
    reason: ACTION_MISSING_DESTINATION_REASON,
  },
  hide: {
    message: 'Hide needs a Stealth check — use the Hide option.',
    reason: HIDE_CHECK_UNROUTABLE_REASON,
  },
} as const;

describe('a declared action the engine cannot execute as-is', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: PLAYER_ID, name: 'The Reveler' },
    });
    chatWithDM.mockResolvedValue({ text: 'The moment hangs.', narrationSegments: [] });
  });

  it.each(['attack', 'move'] as const)(
    'refuses a player %s with nothing to execute and keeps the turn open',
    async (actionType) => {
      const expected = EXPECTED[actionType];
      const result = await run([malformedAction(PLAYER_ID, actionType)]);

      // Not settled as acted: no intent ever leaves for the refused declaration, the
      // turn never ends, and no NPC turn advances.
      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
      expect(endTurnIntents()).toEqual([]);
      // No repair is spent: the player re-declares, the refusal already names the fix.
      expect(repairRefusedCombatAction).not.toHaveBeenCalled();
      // The real executor refused before any fetch: no intent ever reached the server.
      expect(fetchMock).not.toHaveBeenCalled();

      // The refusal reaches the narration pass named as a refusal, carrying no outcome.
      const payload = resolutionPayload();
      expect(payload.refusedActions).toHaveLength(1);
      expect(payload.refusedActions[0]).toMatchObject({
        resolved: false,
        action: actionType,
        refusalReason: expected.reason,
      });
      expect(payload.authoritativeCombatResults).toHaveLength(0);

      // And the player reads it, in this layer's words rather than the model's.
      expect(result.text).toContain(expected.message);
      expect(result.text).toContain('still your turn');
    },
  );

  it('refuses a DM-declared hide the engine will not take as a Stealth check', async () => {
    // The hide IS routed: the check intent is attempted against the intent route (the
    // executor calls the real `executeAuthoritativeCombatIntent`, which posts via the
    // stubbed fetch). The engine refuses it, and only then does the executor's fallback
    // refusal fire.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ error: 'nothing to hide behind', details: { reason: 'no_cover' } }),
    });

    const result = await run([malformedAction(PLAYER_ID, 'hide')]);

    // The check intent was attempted exactly once — routing, not a silent settle.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('/v1/combat/');
    expect(init.body).toContain('"type":"check"');
    expect(init.body).toContain('"checkKind":"hide"');
    // But the turn never ends on the refusal and no NPC turn advances.
    expect(init.body).not.toContain('"type":"end_turn"');
    expect(endTurnIntents()).toEqual([]);
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();

    const payload = resolutionPayload();
    expect(payload.refusedActions).toHaveLength(1);
    expect(payload.refusedActions[0]).toMatchObject({
      resolved: false,
      action: 'hide',
      refusalReason: HIDE_CHECK_UNROUTABLE_REASON,
    });
    expect(payload.authoritativeCombatResults).toHaveLength(0);

    expect(result.text).toContain(EXPECTED.hide.message);
    expect(result.text).toContain('still your turn');
  });

  it('refuses an action_type outside the union instead of settling it', async () => {
    // Parsed DM JSON can carry a verb the schema never defined. It used to fall into
    // the executor's catch-all empty success and settle like an executed action.
    const result = await run([malformedAction(PLAYER_ID, 'sneak')]);

    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(endTurnIntents()).toEqual([]);
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    const payload = resolutionPayload();
    expect(payload.refusedActions).toHaveLength(1);
    expect(payload.refusedActions[0]).toMatchObject({
      resolved: false,
      action: 'sneak',
      refusalReason: ACTION_NOT_SUPPORTED_REASON,
    });
    expect(payload.authoritativeCombatResults).toHaveLength(0);

    expect(result.text).toContain('That action is not supported yet');
    expect(result.text).toContain('still your turn');
  });

  // After an NPC pre-flight the turn already sits with the player, so the refusal used
  // to reach them as "declared out of turn" — wrong action, wrong reason, and the
  // narration was told it was not their turn. The refusal has to name itself there too.
  it.each(['attack', 'move', 'hide'] as const)(
    'still names a player %s refusal after an NPC pre-flight, on the player\u2019s own turn',
    async (actionType) => {
      if (actionType === 'hide') {
        fetchMock.mockResolvedValue({
          ok: false,
          status: 422,
          json: async () => ({
            error: 'nothing to hide behind',
            details: { reason: 'no_cover' },
          }),
        });
      }
      const expected = EXPECTED[actionType];
      const result = await run([malformedAction(PLAYER_ID, actionType)], {
        // The server drain's shape (npc-turn-runner AdvanceNpcTurnsResult).
        preResolvedNpcTurns: {
          results: [],
          currentParticipant: { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
          round: 1,
          combatEnded: false,
          iterationCount: 1,
          iterationCap: 4,
          capReached: false,
          transcriptLines: [],
          engineRows: [],
        },
      });

      expect(result.text).toContain(expected.message);
      expect(result.text).toContain('still your turn');
      expect(result.text).not.toContain('out of turn');
      expect(endTurnIntents()).toEqual([]);
      expect(repairRefusedCombatAction).not.toHaveBeenCalled();

      // And the narration pass is told the same: it did not happen, still their turn.
      expect(resolutionPayload().refusedActionsNote).toContain('still their turn');
    },
  );
});
