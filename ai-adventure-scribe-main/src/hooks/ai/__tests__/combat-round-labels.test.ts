/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROUND_FIGHT_PLAYER_ID,
  ROUND_FIGHT_PLAYER_NAME,
  THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES,
  TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES,
} from '../../../../shared/test-fixtures/advance-npc-turns-rounds';
import { receivedNpcMessages } from '../../../../shared/test-fixtures/npc-engine-messages';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';
import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { CombatIntentRefusedError } from '@/services/combat/combat-action-executor';

/**
 * #2393: run 16 read `ROUND 1 · PLAYER`, `ROUND 2 · NPC`, `ROUND 2 · PLAYER`, `ROUND 3 · NPC` in
 * a two-actor fight. The round on an engine line is the round the actor acted in, and a round
 * changes only when the initiative order wraps.
 *
 * The NPC bodies are the ones the real runner produced (`advance-npc-turns-rounds`, asserted
 * against it in `npc-turn-runner.test.ts`). The participants and the round the player acts in
 * come from `mapAuthoritativeCombat`, the client's only producer of an encounter, exactly as the
 * hook hands them to the resolution step. That encounter carries no `turnOrder`, which is what
 * the old inference needed and never had.
 */

const chatWithDM = vi.fn();
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const askPlayerForAttackDie = vi.fn();
const advanceNpcTurns = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({ repairRefusedCombatAction: vi.fn() }));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  ...(await importOriginal<typeof PlayerAttackRoll>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args) },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const serverParticipant = (id: string, name: string, participantType: string) => ({
  id,
  name,
  participantType,
  initiative: 10,
  initiativeModifier: 0,
  armorClass: 12,
  maxHp: 20,
  speed: 30,
  isActive: true,
  status: { currentHp: 20, maxHp: 20, tempHp: 0, isConscious: true },
});

/** The encounter the client holds when the player is about to act in `round`. */
const encounterInRound = (round: number, order: Array<'player' | string>) =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: 'session-1',
      status: 'active',
      currentRound: round,
      currentTurnOrder: 0,
      startedAt: '2026-09-29T00:00:00.000Z',
    },
    participants: order.map((seat) =>
      seat === 'player'
        ? serverParticipant(ROUND_FIGHT_PLAYER_ID, ROUND_FIGHT_PLAYER_NAME, 'player')
        : serverParticipant(seat, `Monster ${seat}`, 'monster'),
    ),
  });

const attack = (actorId: string, targetId: string): any => ({
  actor_id: actorId,
  action_type: 'attack',
  target_ids: [targetId],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

const label = (block: { round: number; source: string }) =>
  `ROUND ${block.round} · ${block.source.toUpperCase()}`;

/**
 * One player turn as the hook runs it: the round comes from the freshly mapped encounter, the
 * pre-flight body (if any) is handed in already resolved, and the body after the player's turn
 * comes from `advanceNpcTurns`.
 */
const playerTurn = async (params: {
  round: number;
  order: Array<'player' | string>;
  target: string;
  /** The `advanceNpcTurns` bodies the turn consumes, in call order. */
  advance: unknown[];
  preflight?: unknown;
}) => {
  const encounter = encounterInRound(params.round, params.order);
  for (const body of params.advance) advanceNpcTurns.mockResolvedValueOnce(body);
  const result = await resolveDeclaredCombatActions({
    encounterId: 'enc-1',
    sessionId: 'session-1',
    combatActions: [attack(ROUND_FIGHT_PLAYER_ID, params.target)],
    declarationText: 'I strike.',
    participants: encounter.participants,
    aiContext: { sessionId: 'session-1', gameState: { isInCombat: true } },
    conversationHistory: [],
    combatRound: encounter.currentRound,
    ...(params.preflight ? { preResolvedNpcTurns: params.preflight as any } : {}),
  });
  const npcBlocks = (batch: unknown) => receivedNpcMessages(batch, encounter.participants).flatMap((message) => message.context.combatEngineBlocks);
  return [
    ...npcBlocks(params.preflight), ...params.advance.slice(0, -1).flatMap(npcBlocks),
    ...(result.combatEngineBlocks ?? []), ...npcBlocks(params.advance.at(-1)),
  ].map(label);
};

describe('engine line round labels (#2393)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askPlayerForAttackDie.mockResolvedValue(null);
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: 'npc1', hit: true, finalDamage: 6, newHp: 14 }],
      result: {
        actorName: ROUND_FIGHT_PLAYER_NAME,
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
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: 'npc1', name: 'Balthazar' },
    });
    chatWithDM.mockResolvedValue({ text: 'Steel rings.', narrationSegments: [] });
  });

  it('2 actors, player first: the round changes only when the order wraps', async () => {
    const order = ['player', 'npc1'];
    const [turn1, turn2] = TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES;

    const labels = [
      ...(await playerTurn({ round: 1, order, target: 'npc1', advance: [turn1] })),
      ...(await playerTurn({ round: 2, order, target: 'npc1', advance: [turn2] })),
    ];

    expect(labels).toEqual([
      'ROUND 1 · PLAYER',
      'ROUND 1 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 2 · NPC',
    ]);
  });

  it('3 actors, player between two NPCs: the NPC that opens the next round is labelled with it', async () => {
    const order = ['npc0', 'player', 'npc2'];
    const [preflight, afterTurn1, afterTurn2] = THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES;

    const labels = [
      ...(await playerTurn({ round: 1, order, target: 'npc0', preflight, advance: [afterTurn1] })),
      ...(await playerTurn({ round: 2, order, target: 'npc0', advance: [afterTurn2] })),
    ];

    expect(labels).toEqual([
      'ROUND 1 · NPC',
      'ROUND 1 · PLAYER',
      'ROUND 1 · NPC',
      'ROUND 2 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 2 · NPC',
      'ROUND 3 · NPC',
    ]);
  });

  it('a player action refused behind a stale NPC holder is labelled with the round the recovery reaches', async () => {
    const order = ['npc0', 'player', 'npc2'];
    const [, recovery, afterAction] = THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES;
    // The encounter was read with `npc2` still holding the turn in round 1; settling it wraps the
    // order, so the player's retried action is a round 2 action.
    executeStructuredCombatActionWithBoundary.mockRejectedValueOnce(
      new CombatIntentRefusedError('Actor is not the current-turn participant', 422, {
        currentParticipantId: 'npc2',
        currentParticipantSlug: 'npc2',
      }),
    );

    const labels = await playerTurn({
      round: 1,
      order,
      target: 'npc0',
      advance: [recovery, afterAction],
    });

    expect(labels).toEqual([
      'ROUND 1 · NPC',
      'ROUND 2 · NPC',
      'ROUND 2 · PLAYER',
      'ROUND 2 · NPC',
      'ROUND 3 · NPC',
    ]);
  });
});
