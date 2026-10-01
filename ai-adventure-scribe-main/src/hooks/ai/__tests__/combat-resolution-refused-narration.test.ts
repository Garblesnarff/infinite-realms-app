/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';
import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';

import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';

/**
 * A refused action has no outcome, so nothing may narrate one.
 *
 * Session 2f420489, 2026-08-12, on a confirmed-current bundle. The player punched. Balthazar
 * held the turn, so the engine refused the player's attack 422 — correctly; it was never rolled
 * and no hit points moved. The #1701 repair loop then regenerated Balthazar's own turn, which
 * was accepted. And the narration the player read opened:
 *
 *     "Your strike with the greataxe leaves a deep gash in Balthazar's form… He is clearly
 *      bloodied."
 *
 * A hit, a wound, a condition tier, and a weapon the character was not holding — for an action
 * the engine had rejected. This is #1711's fake-kill pattern with full logs behind it.
 *
 * The channel is identifiable: everything the resolution pass sees is engine output, and a
 * refused action produces none. The one place the DM could have read a player attack that never
 * happened is its OWN declaration prose, handed back to it as the established fact the
 * resolution is written against. So this pins three things:
 *
 *   1. The refused action reaches the narration pass named as a refusal, carrying no outcome.
 *   2. The declaration that was refused is withheld — the DM narrates from engine results only.
 *   3. Whose turn it is is stated by this layer, not left to the model to remember.
 *
 * The stub DM below deliberately narrates from what it is handed, the way the real one did:
 * given the declaration prose it will repeat it. That is what makes (2) a real assertion rather
 * than a check that a mock returned a constant.
 */

const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const repairRefusedCombatAction = vi.fn();
const askPlayerForAttackDie = vi.fn();
const advanceNpcTurns = vi.fn();

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
  // The error class is the real one: the resolution step branches on `instanceof`, and a
  // look-alike would take the "not a refusal, rethrow" path and pass this file for the wrong
  // reason.
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  // `isPlayerActor` stays real — telling the player's actions apart is the thing under test.
  ...(await importOriginal<typeof PlayerAttackRoll>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const PLAYER_ID = '8eeac28d-0000-4000-8000-000000000001';
const PLAYER_SLUG = 'the-reveler';
const NPC_ID = 'b962bd05-0000-4000-8000-000000000002';

const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
  { id: NPC_ID, name: 'Balthazar', participantType: 'monster' },
];

const action = (actorId: string, targetId: string): any => ({
  actor_id: actorId,
  action_type: 'attack',
  target_ids: [targetId],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

/** The declaration the DM wrote for the turn — the prose that invented the greataxe. */
const DECLARATION =
  "Your strike with the greataxe leaves a deep gash in Balthazar's form. He is clearly bloodied.";

const outOfTurn = () =>
  new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
    currentParticipantId: NPC_ID,
    currentParticipantSlug: 'balthazar',
  });

const resolutionPayload = () => JSON.parse(chatWithDM.mock.calls[0][0].message);
const setupMessage = () => {
  const history = chatWithDM.mock.calls[0][0].conversationHistory;
  return history[history.length - 1].content as string;
};

const run = (overrides: Record<string, unknown> = {}) =>
  resolveDeclaredCombatActions({
    encounterId: '10444307-0000-4000-8000-000000000003',
    combatActions: [action(PLAYER_ID, NPC_ID)],
    declarationText: DECLARATION,
    participants: PARTICIPANTS,
    aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
    conversationHistory: [],
    ...overrides,
  });

describe('a player action the engine refused', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The turn is refused for the player, and the repair regenerates the current NPC's turn —
    // exactly what production did.
    executeStructuredCombatActionWithBoundary.mockImplementation(
      async (_encounterId: string, act: any) => {
        if (act.actor_id === PLAYER_ID) throw outOfTurn();
        return {
          outcomes: [{ participantId: PLAYER_ID, hit: true, finalDamage: 4, newHp: 7 }],
          boundary: null,
        };
      },
    );
    // The engine ends the NPC's turn itself now, so the client's `end_turn` is told the boundary
    // already happened and hands back who is up.
    executeAuthoritativeCombatIntent.mockResolvedValue({
      turnAlreadyEnded: true,
      currentParticipant: { id: PLAYER_ID, name: 'The Reveler' },
    });
    repairRefusedCombatAction.mockResolvedValue({
      text: 'Balthazar lunges.',
      combat_actions: [action(NPC_ID, PLAYER_ID)],
    });
    askPlayerForAttackDie.mockResolvedValue(null);
    // A DM that writes from whatever it is handed, which is what the real one did.
    chatWithDM.mockImplementation(async ({ message, conversationHistory }: any) => ({
      text: `${conversationHistory[conversationHistory.length - 1]?.content ?? ''} ${message}`,
      narrationSegments: [],
    }));
  });

  it('is never narrated as an outcome: the refused declaration is withheld', async () => {
    const result = await run();

    // The fabricated sentence reached the narration pass as established fact. It must not.
    expect(setupMessage()).not.toContain('greataxe');
    expect(setupMessage()).not.toContain('bloodied');
    expect(result.text).not.toContain('greataxe');
    expect(result.text).not.toContain('bloodied');
  });

  it('withholds the refusal from the narration after a successful repair', async () => {
    await run();

    const payload = resolutionPayload();
    expect(payload.refusedActions).toBeUndefined();
    expect(payload.authoritativeCombatResults).toHaveLength(1);
    expect(payload.authoritativeCombatResults[0].action.actor_id).toBe(NPC_ID);
  });

  it('narrates the accepted actions only', async () => {
    await run();

    // The repaired NPC turn is the only thing the engine resolved, and the only thing with an
    // outcome to report.
    const payload = resolutionPayload();
    expect(payload.authoritativeCombatResults).toHaveLength(1);
    expect(payload.authoritativeCombatResults[0].action.actor_id).toBe(NPC_ID);
    expect(payload.authoritativeCombatResults[0].outcomes[0]).toMatchObject({ finalDamage: 4 });
  });

  it('drops the stale refusal notice when the repair hands the turn back to the player', async () => {
    const result = await run();

    // The engine advanced onto the player when Balthazar spent his action. The refusal is stale,
    // and the handoff line is what tells the player it is their turn now.
    expect(result.text).not.toContain('declared out of turn');
    expect(result.text).not.toContain('acts next');
    expect(result.text.trimEnd().endsWith('The Reveler, what do you do?')).toBe(true);
  });

  it("names the creature the fight is waiting on when the repair leaves it the creature's turn", async () => {
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: NPC_ID, name: 'Balthazar' },
    });

    const result = await run();

    // The #1744 lockout was a player who was never told anything at all. The line is written by
    // this layer, not left to the model, and it no longer calls the repaired turn "out of turn".
    expect(result.text.trimEnd().endsWith('*(Balthazar acts next.)*')).toBe(true);
    expect(result.text).not.toContain('declared out of turn');
    expect(result.text).not.toContain('what do you do?');
  });

  it('still throws when the engine refused everything and the repair could not help', async () => {
    // Nothing was resolved, so there is no turn to narrate. A silent empty narration would be a
    // worse answer than the error.
    repairRefusedCombatAction.mockResolvedValue(null);

    await expect(run()).rejects.toThrow('Actor is not the current-turn participant');
  });

  it('reports a refused repair instead of throwing it as a generic error (#2234)', async () => {
    // Run M4 turn 7 ended in "I encountered an issue processing your message": the repair's own
    // action was refused, and that refusal escaped the loop and discarded the whole turn.
    // The repaired action is Balthazar's: since #2305 a repair never acts for the player (the
    // next test), so the refused repair that reaches the engine is the turn holder's.
    executeStructuredCombatActionWithBoundary.mockImplementation(async () => {
      throw outOfTurn();
    });
    repairRefusedCombatAction.mockResolvedValue({
      text: 'Balthazar lunges.',
      combat_actions: [action(NPC_ID, PLAYER_ID)],
    });

    const result = await run();

    const payload = resolutionPayload();
    expect(payload.refusedActions).toHaveLength(2);
    expect(payload.authoritativeCombatResults).toHaveLength(0);
    expect(result.text).toBeTruthy();
  });

  it('never lets the repair act for the player: its re-declaration is withheld (#2303, #2305)', async () => {
    // Run 13: the player's Chill Touch was refused, the repair re-declared it, and the engine
    // rolled it — REFUSED and HIT for one cast, and a d20 the player never threw.
    repairRefusedCombatAction.mockResolvedValue({
      text: 'The Reveler tries again.',
      combat_actions: [action(PLAYER_ID, NPC_ID)],
    });

    const result = await run();

    // The player's own declaration reached the engine once; the repair's copy never did.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    const payload = resolutionPayload();
    expect(payload.refusedActions).toHaveLength(1);
    expect(payload.withheldPlayerActions).toEqual([
      expect.objectContaining({ actor: 'The Reveler', action: 'attack', source: 'repair' }),
    ]);
    expect(payload.authoritativeCombatResults).toHaveLength(0);
    expect(result.text).toBeTruthy();
  });

  it('still repairs a typed player action refused because a creature holds the turn (#2443)', async () => {
    // The skip is for refusals no repair can answer. Here the refusal names whose turn it is, and
    // the repair's one useful result is that creature's own action.
    const result = await run({ playerInputOrigin: 'typed' });

    expect(repairRefusedCombatAction).toHaveBeenCalledTimes(1);
    expect(resolutionPayload().authoritativeCombatResults[0].action.actor_id).toBe(NPC_ID);
    expect(result.text).toBeTruthy();
  });

  it('spends no repair call on a typed player action refused for any other reason (#2443)', async () => {
    executeStructuredCombatActionWithBoundary.mockRejectedValue(
      new CombatIntentRefusedError('No spell slot left at that level', 422, {}),
    );

    const result = await run({ playerInputOrigin: 'typed' });

    // The refusal is reported and the turn narrated, as when a repair's re-declaration is withheld.
    expect(resolutionPayload().refusedActions).toHaveLength(1);
    expect(result.text).toBeTruthy();
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
  });

  it('queues a refused pending declaration instead of repairing it as the current-turn actor', async () => {
    await run({ queuedIntentActorIds: [PLAYER_ID] });

    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(resolutionPayload().refusedActions[0]).toMatchObject({
      actor: 'The Reveler',
      queued: true,
    });
  });

  it('recognizes the queued participant when the DM uses its board slug', async () => {
    executeStructuredCombatActionWithBoundary.mockImplementation(
      async (_encounterId: string, act: any) => {
        if (act.actor_id === PLAYER_SLUG) throw outOfTurn();
        return { outcomes: [], boundary: null };
      },
    );

    await run({
      combatActions: [action(PLAYER_SLUG, NPC_ID)],
      queuedIntentActorIds: [PLAYER_ID],
    });

    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    expect(resolutionPayload().refusedActions[0]).toMatchObject({ queued: true });
  });

  describe('when the recovery retry is refused again', () => {
    /** Balthazar's stale turn is settled, but the player's retried attack is still refused. */
    const runFailedRecovery = (holder: {
      id: string;
      name: string;
      participantType: string;
    }): ReturnType<typeof run> => {
      advanceNpcTurns.mockResolvedValue({
        results: [
          {
            action: action(NPC_ID, PLAYER_ID),
            outcomes: [{ participantId: PLAYER_ID, hit: false }],
            engineResult: { actorName: 'Balthazar', targetName: 'The Reveler', hit: false },
            actorIsPlayer: false,
            transcriptLines: [],
          },
        ],
        currentParticipant: holder,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      });
      return run({ sessionId: 'session-2f420489' });
    };

    it('reaches the narration pass named as a refusal, carrying no outcome', async () => {
      await runFailedRecovery({ id: NPC_ID, name: 'Balthazar', participantType: 'monster' });

      const payload = resolutionPayload();
      expect(repairRefusedCombatAction).not.toHaveBeenCalled();
      expect(payload.refusedActions.length).toBeGreaterThan(0);
      expect(payload.refusedActions[0]).toMatchObject({
        resolved: false,
        actor: 'The Reveler',
        actorIsPlayer: true,
        action: 'attack',
        currentTurn: 'Balthazar',
      });
      // No hit, no damage, no new hit points — the engine rolled nothing for it.
      expect(JSON.stringify(payload.refusedActions)).not.toContain('finalDamage');
      expect(payload.refusedActionsNote).toContain('did not happen');
    });

    it('tells the player it is their turn now when the turn came back to them', async () => {
      const result = await runFailedRecovery({
        id: PLAYER_ID,
        name: 'The Reveler',
        participantType: 'player',
      });

      expect(result.text).toContain('not resolved');
      expect(result.text).toContain('your turn now');
    });

    it("names the creature the fight is waiting on when it is still not the player's turn", async () => {
      const result = await runFailedRecovery({
        id: NPC_ID,
        name: 'Balthazar',
        participantType: 'monster',
      });

      expect(result.text).toContain("it is Balthazar's turn");
    });
  });
});

describe('a turn the engine accepted in full', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 6, newHp: 3 }],
      boundary: null,
    });
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: NPC_ID, name: 'Balthazar' },
    });
    askPlayerForAttackDie.mockResolvedValue(null);
    advanceNpcTurns.mockResolvedValue({
      results: [],
      currentParticipant: { id: NPC_ID, name: 'Balthazar', participantType: 'monster' },
      combatEnded: false,
      iterationCount: 0,
      iterationCap: 4,
      capReached: false,
      transcriptLines: [],
    });
    chatWithDM.mockImplementation(async ({ message, conversationHistory }: any) => ({
      text: `${conversationHistory[conversationHistory.length - 1]?.content ?? ''} ${message}`,
    }));
  });

  it('is unchanged: the declaration still frames the narration and nothing is appended', async () => {
    const result = await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      combatActions: [action(NPC_ID, PLAYER_ID)],
      declarationText: 'Balthazar swings.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(setupMessage()).toBe('Balthazar swings.');
    expect(resolutionPayload().refusedActions).toBeUndefined();
    expect(result.text).not.toContain('not resolved');
  });

  it('takes the player-roll path when the DM declares the player attack by slug', async () => {
    const sluggedAttack = action(PLAYER_SLUG, NPC_ID);
    askPlayerForAttackDie.mockResolvedValue({ d20: 17, autoRolled: false, movementOnly: false });

    await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      combatActions: [sluggedAttack],
      declarationText: 'The Reveler attacks Balthazar.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(askPlayerForAttackDie).toHaveBeenCalledWith(
      expect.objectContaining({ action: sluggedAttack }),
    );
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      '10444307-0000-4000-8000-000000000003',
      sluggedAttack,
      17,
    );
  });

  it('carries pre-flight NPC engine results into the same reply as the player declaration', async () => {
    const npcEngineResult = {
      actorName: 'Balthazar',
      targetName: 'The Reveler',
      d20: 9,
      attackBonus: 3,
      totalAttackRoll: 12,
      targetAC: 12,
      hit: true,
      finalDamage: 4,
      damageType: 'bludgeoning',
      targetCondition: 'wounded',
      autoRolled: true,
    };
    const preflightNpcAction = action(NPC_ID, PLAYER_ID);
    executeStructuredCombatActionWithBoundary.mockResolvedValueOnce({
      outcomes: [{ participantId: NPC_ID, hit: false }],
      result: {
        actorName: 'The Reveler',
        targetName: 'Balthazar',
        d20: 16,
        attackBonus: 5,
        totalAttackRoll: 21,
        targetAC: 12,
        hit: true,
        finalDamage: 6,
        damageType: 'slashing',
      },
      boundary: null,
    });
    const result = await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      sessionId: 'session-2f420489',
      combatActions: [action(PLAYER_ID, NPC_ID)],
      declarationText: 'The Reveler strikes.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
      preResolvedNpcTurns: {
        results: [
          {
            action: preflightNpcAction,
            outcomes: [{ participantId: PLAYER_ID, hit: true, finalDamage: 4, newHp: 7 }],
            engineResult: npcEngineResult,
            actorIsPlayer: false,
            transcriptLines: ['⚙️ Engine: Balthazar strikes before your turn.'],
          },
        ],
        currentParticipant: { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      },
    });

    const payload = resolutionPayload();
    expect(payload.authoritativeCombatResults).toHaveLength(2);
    expect(payload.authoritativeCombatResults[0]).toMatchObject({
      actorIsPlayer: false,
      action: { actor_id: NPC_ID },
      engineResult: npcEngineResult,
    });
    expect(payload.authoritativeCombatResults[1].action.actor_id).toBe(PLAYER_ID);
    expect(result.text).toContain('Balthazar strikes before your turn.');
  });

  it('prepends the engine result to the player transcript and forwards the raw payload', async () => {
    const engineResult = {
      actorName: 'Balthazar',
      targetName: 'The Reveler',
      d20: 12,
      attackBonus: 4,
      totalAttackRoll: 16,
      targetAC: 12,
      hit: true,
      finalDamage: 3,
      damageType: 'slashing',
      targetCondition: 'wounded',
      autoRolled: true,
      weaponResolution: { resolved: 'Unarmed Strike', substituted: false },
    };
    executeStructuredCombatActionWithBoundary.mockResolvedValueOnce({
      outcomes: [{ participantId: PLAYER_ID, hit: true, finalDamage: 3, newHp: 7 }],
      result: engineResult,
      boundary: null,
    });

    const result = await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      combatActions: [action(NPC_ID, PLAYER_ID)],
      declarationText: 'Balthazar swings.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(result.text.startsWith('⚙️ Engine:')).toBe(true);
    expect(result.text).toContain('12 + 4 = 16 vs AC 12');
    expect(result.text).toContain('3 slashing damage');
    expect(result.text).toContain('The Reveler is wounded');
    expect(resolutionPayload().authoritativeCombatResults[0].engineResult).toEqual(engineResult);
  });

  it('drops trailing actions after the synthesized turn boundary', async () => {
    const second = action(NPC_ID, PLAYER_ID);

    await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      combatActions: [action(NPC_ID, PLAYER_ID), second],
      declarationText: 'Balthazar attacks twice.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
    expect(resolutionPayload().authoritativeCombatResults).toHaveLength(1);
  });

  it('drops trailing actions immediately when the first action ends combat', async () => {
    executeStructuredCombatActionWithBoundary.mockResolvedValueOnce({
      outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 6, newHp: 0 }],
      boundary: 'combat_ended',
    });

    await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      combatActions: [action(NPC_ID, PLAYER_ID), action(NPC_ID, PLAYER_ID)],
      declarationText: 'Balthazar attacks and wins.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(resolutionPayload().authoritativeCombatResults).toHaveLength(1);
  });

  it('does not narrate a batch that arrived after the encounter concluded', async () => {
    executeStructuredCombatActionWithBoundary.mockResolvedValueOnce({
      outcomes: [],
      boundary: 'encounter_already_concluded',
    });

    await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      combatActions: [action(NPC_ID, PLAYER_ID), action(NPC_ID, PLAYER_ID)],
      declarationText: 'Balthazar swings after the fight is over.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(resolutionPayload()).toMatchObject({
      encounterAlreadyConcluded: true,
      authoritativeCombatResults: [],
    });
    expect(setupMessage()).not.toContain('Balthazar swings after the fight is over');
  });

  it('runs autonomous NPC turns after the player boundary and ends with the player handoff', async () => {
    const npcEngineResult = {
      actorName: 'Balthazar',
      targetName: 'The Reveler',
      d20: 14,
      attackBonus: 3,
      totalAttackRoll: 17,
      targetAC: 12,
      hit: true,
      finalDamage: 4,
      damageType: 'bludgeoning',
      targetCondition: 'wounded',
      autoRolled: true,
    };
    executeStructuredCombatActionWithBoundary.mockResolvedValueOnce({
      outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 6, newHp: 3 }],
      result: {
        actorName: 'The Reveler',
        targetName: 'Balthazar',
        d20: 16,
        attackBonus: 5,
        totalAttackRoll: 21,
        targetAC: 12,
        hit: true,
        finalDamage: 6,
        damageType: 'slashing',
        targetCondition: 'wounded',
      },
      boundary: null,
    });
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: NPC_ID, name: 'Balthazar' },
    });
    advanceNpcTurns.mockResolvedValue({
      results: [
        {
          action: action(NPC_ID, PLAYER_ID),
          // The runner stamps the round the NPC acted in (#2393); a two-actor fight with the
          // player first has the NPC answering in the player's own round.
          round: 1,
          outcomes: [{ participantId: PLAYER_ID, hit: true, finalDamage: 4, newHp: 7 }],
          engineResult: npcEngineResult,
          actorIsPlayer: false,
          transcriptLines: [],
        },
      ],
      currentParticipant: { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
      round: 2,
      combatEnded: false,
      iterationCount: 1,
      iterationCap: 4,
      capReached: false,
      transcriptLines: [],
    });

    const result = await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      sessionId: 'session-2f420489',
      combatActions: [action(PLAYER_ID, NPC_ID)],
      declarationText: 'The Reveler strikes.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(advanceNpcTurns).toHaveBeenCalledWith('session-2f420489', NPC_ID);
    expect(executeAuthoritativeCombatIntent.mock.invocationCallOrder[0]).toBeLessThan(
      advanceNpcTurns.mock.invocationCallOrder[0],
    );
    const payload = resolutionPayload();
    expect(payload.authoritativeCombatResults).toHaveLength(2);
    expect(payload.authoritativeCombatResults[1]).toMatchObject({
      actorIsPlayer: false,
      action: { actor_id: NPC_ID },
      engineResult: npcEngineResult,
    });
    expect(result.text.startsWith('⚙️ Engine:')).toBe(true);
    expect(result.text).toContain('The Reveler');
    expect(result.text).toContain('Balthazar');
    expect(result.text.trimEnd().endsWith('The Reveler, what do you do?')).toBe(true);
    expect(result.combatEngineBlocks).toMatchObject([
      { source: 'player', round: 1 },
      { source: 'npc', round: 1 },
    ]);
  });

  it('settles a stale NPC holder and retries the refused player action once', async () => {
    let refusePlayerOnce = true;
    executeStructuredCombatActionWithBoundary.mockImplementation(
      async (_encounterId: string, act: any) => {
        if (act.actor_id === PLAYER_ID && refusePlayerOnce) {
          refusePlayerOnce = false;
          throw outOfTurn();
        }
        return {
          outcomes: [{ participantId: NPC_ID, hit: true, finalDamage: 3, newHp: 6 }],
          result: {
            actorName: 'The Reveler',
            targetName: 'Balthazar',
            d20: 15,
            attackBonus: 5,
            totalAttackRoll: 20,
            targetAC: 12,
            hit: true,
            finalDamage: 3,
            damageType: 'slashing',
          },
          boundary: null,
        };
      },
    );
    advanceNpcTurns
      .mockResolvedValueOnce({
        results: [
          {
            action: action(NPC_ID, PLAYER_ID),
            outcomes: [{ participantId: PLAYER_ID, hit: false }],
            engineResult: { actorName: 'Balthazar', targetName: 'The Reveler', hit: false },
            actorIsPlayer: false,
            transcriptLines: [],
          },
        ],
        currentParticipant: { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      })
      .mockResolvedValueOnce({
        results: [],
        currentParticipant: { id: PLAYER_ID, name: 'The Reveler', participantType: 'player' },
        combatEnded: false,
        iterationCount: 0,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      });

    const result = await resolveDeclaredCombatActions({
      encounterId: '10444307-0000-4000-8000-000000000003',
      sessionId: 'session-2f420489',
      combatActions: [action(PLAYER_ID, NPC_ID)],
      declarationText: 'The Reveler strikes.',
      participants: PARTICIPANTS,
      aiContext: { sessionId: 'session-2f420489', gameState: { isInCombat: true } },
      conversationHistory: [],
    });

    expect(advanceNpcTurns).toHaveBeenNthCalledWith(1, 'session-2f420489', NPC_ID);
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(2);
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    expect(chatWithDM).toHaveBeenCalledTimes(1);
    expect(resolutionPayload().refusedActions).toBeUndefined();
    expect(resolutionPayload().authoritativeCombatResults).toHaveLength(2);
    expect(result.text.trimEnd().endsWith('The Reveler, what do you do?')).toBe(true);
  });
});
