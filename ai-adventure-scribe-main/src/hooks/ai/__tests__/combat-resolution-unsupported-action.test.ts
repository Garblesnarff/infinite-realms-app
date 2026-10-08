/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';
import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';

import { ACTION_NOT_SUPPORTED_REASON } from '@/services/combat/combat-action-executor';

/**
 * A declared Help, Ready, or Use Object action has no engine owner: the intent schema
 * knows attack, spell, dash, dodge, disengage, move, and end_turn — nothing else. The
 * executor refuses it, and this layer must refuse VISIBLY: the player is told the action
 * is not supported yet, the turn stays open, and no NPC turn advances on an action that
 * never happened.
 *
 * Before the fix the executor returned an empty success for these types, so the
 * declaration settled exactly like an executed action: `end_turn` was posted and NPC
 * turns advanced, and the DM was handed no outcome to narrate — so it invented one.
 * That silent settle is what these tests pin shut:
 *
 *   1. No `end_turn` intent is posted for the refused actor.
 *   2. No creature runs either: the server runs NPC turns only behind an accepted End turn
 *      (#2658 step 3), and none is sent.
 *   3. The refusal reaches the narration pass named as a refusal, and the reply the
 *      player reads says the action is not supported yet and it is still their turn.
 *   4. No repair is spent on it: no re-declaration can make the engine support a type
 *      it has no owner for.
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
  // The real module, error class and reason constant included. Only the intent POST is
  // stubbed (it would fetch); `executeStructuredCombatActionWithBoundary` itself stays
  // real — for the action types under test it throws before any fetch, so the
  // executor-to-resolution chain runs end to end and a change to the refusal's shape
  // fails here rather than against a hand-built look-alike.
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  // `isPlayerActor` stays real — telling the player's actions apart is the thing under test.
  ...(await importOriginal<typeof PlayerAttackRoll>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const PLAYER_ID = '8eeac28d-0000-4000-8000-000000000001';
const NPC_ID = 'b962bd05-0000-4000-8000-000000000002';

const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
  { id: NPC_ID, name: 'Balthazar', participantType: 'monster' },
];

const unsupportedAction = (actorId: string, actionType: string, targetId?: string): any => ({
  actor_id: actorId,
  action_type: actionType,
  target_ids: targetId ? [targetId] : [],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

/** The End turn intents this layer sent: the one request behind which the server runs NPC turns. */
const endTurnIntents = () =>
  executeAuthoritativeCombatIntent.mock.calls.filter(
    ([, intent]: any[]) => intent?.type === 'end_turn',
  );

const resolutionPayload = () => JSON.parse(chatWithDM.mock.calls[0][0].message);

const run = (combatActions: any[], overrides: Record<string, unknown> = {}) =>
  resolveDeclaredCombatActions({
    encounterId: '10444307-0000-4000-8000-000000000003',
    combatActions,
    declarationText: 'The Reveler moves to assist.',
    participants: PARTICIPANTS,
    aiContext: { sessionId: 'session-2596', gameState: { isInCombat: true } },
    conversationHistory: [],
    ...overrides,
  });

describe('a declared action type the engine has no owner for', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: PLAYER_ID, name: 'The Reveler' },
    });
    chatWithDM.mockResolvedValue({ text: 'The moment hangs.', narrationSegments: [] });
  });

  it.each(['help', 'ready', 'use_object'])(
    'refuses a player %s visibly and keeps the turn open',
    async (actionType) => {
      const result = await run([unsupportedAction(PLAYER_ID, actionType, NPC_ID)]);

      // Not settled as acted: the turn never ends and no NPC turn advances.
      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
      expect(endTurnIntents()).toEqual([]);
      // No repair is spent re-declaring a type the engine cannot own.
      expect(repairRefusedCombatAction).not.toHaveBeenCalled();
      // The real executor refused before any fetch: no intent ever reached the server.
      expect(fetchMock).not.toHaveBeenCalled();

      // The refusal reaches the narration pass named as a refusal, carrying no outcome.
      const payload = resolutionPayload();
      expect(payload.refusedActions).toHaveLength(1);
      expect(payload.refusedActions[0]).toMatchObject({
        resolved: false,
        action: actionType,
        refusalReason: ACTION_NOT_SUPPORTED_REASON,
      });
      expect(payload.authoritativeCombatResults).toHaveLength(0);

      // And the player reads it, in this layer's words rather than the model's.
      expect(result.text).toContain('That action is not supported yet');
      expect(result.text).toContain('still your turn');
    },
  );

  it('refuses an NPC help the same way: reported, never settled, nothing advances', async () => {
    await run([unsupportedAction(NPC_ID, 'help', PLAYER_ID)]);

    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(endTurnIntents()).toEqual([]);
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();

    const payload = resolutionPayload();
    expect(payload.refusedActions).toHaveLength(1);
    expect(payload.refusedActions[0]).toMatchObject({
      resolved: false,
      actor: 'Balthazar',
      action: 'help',
      refusalReason: ACTION_NOT_SUPPORTED_REASON,
    });
    expect(payload.authoritativeCombatResults).toHaveLength(0);
  });

  // After an NPC pre-flight the turn already sits with the player, so the refusal used
  // to reach them as "declared out of turn" — wrong action, wrong reason, and the
  // narration was told it was not their turn. The refusal has to name itself there too.
  it.each(['help', 'ready', 'use_object'])(
    'still names a player %s as unsupported after an NPC pre-flight, on the player\u2019s own turn',
    async (actionType) => {
      const result = await run([unsupportedAction(PLAYER_ID, actionType, NPC_ID)], {
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

      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
      expect(endTurnIntents()).toEqual([]);
      expect(repairRefusedCombatAction).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();

      expect(result.text).toContain('That action is not supported yet');
      expect(result.text).toContain('still your turn');
      expect(result.text).not.toContain('out of turn');

      // And the narration pass is told the same: it did not happen, still their turn.
      expect(resolutionPayload().refusedActionsNote).toContain('still their turn');
    },
  );
});
