/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ROUND_FIGHT_PLAYER_ID,
  ROUND_FIGHT_PLAYER_NAME,
  THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES,
  TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES,
} from '../../../../shared/test-fixtures/advance-npc-turns-rounds';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';
import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';
import type { ChatMessage } from '@/types/game';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { DMMessage } from '@/features/game-session/components/chat/message-list/DMMessage';
import { summarizeCombatTurn } from '@/features/game-session/components/game/overhaul/combat-turn-order';
import { CombatTurnBar } from '@/features/game-session/components/game/overhaul/CombatTurnBar';
import { previousEngineDividerKeys } from '@/utils/combat-engine-blocks';

/**
 * #2417, acceptance tests 1 and 2: the chat dividers and the turn bar read the same rounds.
 *
 * The blocks come out of the real resolution step, fed the `advance-npc-turns` bodies the real
 * runner produces (`advance-npc-turns-rounds`, asserted against it in `npc-turn-runner.test.ts`)
 * and the engine result shape the server sends. The bar is read from encounters that
 * `mapAuthoritativeCombat`, the client's only producer of one, builds for each turn.
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
vi.mock('@/contexts/CampaignAssetsContext', () => ({
  useCampaignAssetsContext: () => ({ getAsset: vi.fn() }),
}));
vi.mock('@/contexts/SceneBackgroundContext', () => ({
  useSceneBackground: () => ({ setSceneBackground: vi.fn() }),
}));
vi.mock('@/features/game-session/components/chat/message-list/MessageAssetDisplay', () => ({
  MessageAssetDisplay: () => null,
}));
vi.mock('@/features/game-session/components/chat/message-list/MessageVoicePlayer', () => ({
  MessageVoicePlayer: () => null,
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

type Seat = 'player' | string;

const serverParticipant = (seat: Seat, initiative: number) => ({
  id: seat === 'player' ? ROUND_FIGHT_PLAYER_ID : seat,
  name: seat === 'player' ? ROUND_FIGHT_PLAYER_NAME : `Monster ${seat}`,
  participantType: seat === 'player' ? 'player' : 'monster',
  initiative,
  initiativeModifier: 0,
  armorClass: 12,
  maxHp: 20,
  speed: 30,
  isActive: true,
  status: { currentHp: 20, maxHp: 20, tempHp: 0, isConscious: true },
});

/** The encounter the client holds with `order[turnIndex]` holding the turn in `round`. */
const encounterAt = (round: number, order: Seat[], turnIndex: number) =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: 'session-1',
      status: 'active',
      currentRound: round,
      currentTurnOrder: turnIndex,
      startedAt: '2026-09-29T00:00:00.000Z',
    },
    participants: order.map((seat, index) => serverParticipant(seat, 20 - index * 5)),
  });

/** The full result `resolveAttack` returns once `exposeAttackVisibility` has run (engine-results). */
const playerAttackResult = {
  hit: true,
  d20: 16,
  attackBonus: 5,
  targetAC: 12,
  baseAc: 12,
  coverBonus: 0,
  cover: null,
  totalAttackRoll: 21,
  damage: 6,
  damageType: 'slashing',
  damageBeforeResistances: 6,
  effectiveResistance: false,
  effectiveVulnerability: false,
  effectiveImmunity: false,
  finalDamage: 6,
  targetNewHp: 14,
  targetIsConscious: true,
  targetIsDead: false,
  targetCondition: 'wounded',
  isCritical: false,
  isNaturalOne: false,
  isNaturalTwenty: false,
  autoRolled: false,
  actorName: ROUND_FIGHT_PLAYER_NAME,
  targetName: 'Balthazar',
  weaponResolution: { requested: 'Longsword', resolved: 'Longsword', substituted: false },
};

const attack = (targetId: string): any => ({
  actor_id: ROUND_FIGHT_PLAYER_ID,
  action_type: 'attack',
  target_ids: [targetId],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
});

/** One player turn as the hook runs it, returned as the DM message it saves. */
const playerTurn = async (params: {
  round: number;
  order: Seat[];
  turnIndex: number;
  target: string;
  advance: unknown[];
  preflight?: unknown;
}): Promise<ChatMessage> => {
  const encounter = encounterAt(params.round, params.order, params.turnIndex);
  for (const body of params.advance) advanceNpcTurns.mockResolvedValueOnce(body);
  const result = await resolveDeclaredCombatActions({
    encounterId: 'enc-1',
    sessionId: 'session-1',
    combatActions: [attack(params.target)],
    declarationText: 'I strike.',
    participants: encounter.participants,
    aiContext: { sessionId: 'session-1', gameState: { isInCombat: true } },
    conversationHistory: [],
    combatRound: encounter.currentRound,
    ...(params.preflight ? { preResolvedNpcTurns: params.preflight as any } : {}),
  });
  return {
    sender: 'dm',
    text: 'Steel rings.',
    context: { combatEngineBlocks: result.combatEngineBlocks },
  } as ChatMessage;
};

/** What the chat prints: one divider per message block, in feed order. */
const dividersOf = (messages: ChatMessage[]): string[] => {
  const previous = previousEngineDividerKeys(messages);
  return messages.flatMap((message, index) => {
    const { container, unmount } = render(
      <DMMessage
        message={message}
        messageId={`dm-${index}`}
        isFirstInGroup
        isLastInGroup
        displayContent={message.text}
        isExpanded={false}
        onToggleExpanded={vi.fn()}
        isGeneratingImage={false}
        onGenerateImage={vi.fn()}
        previousEngineKey={previous.get(message)}
      />,
    );
    const found = Array.from(
      container.querySelectorAll('[data-testid="combat-round-divider"]'),
    ).map((node) => node.textContent?.trim() ?? '');
    unmount();
    return found;
  });
};

/** What the bar prints for each state of the fight, in order. */
const barRounds = (states: Array<{ round: number; turnIndex: number }>, order: Seat[]): string[] =>
  states.map(({ round, turnIndex }) => {
    const summary = summarizeCombatTurn(encounterAt(round, order, turnIndex))!;
    const { unmount } = render(<CombatTurnBar summary={summary} busy={null} />);
    const text = screen.getByTestId('combat-turn-bar').textContent ?? '';
    unmount();
    return /Round (\d+)/.exec(text)![0];
  });

describe('turn bar and chat dividers agree on the round (#2417)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    askPlayerForAttackDie.mockResolvedValue(null);
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      outcomes: [{ participantId: 'npc1', hit: true, finalDamage: 6, newHp: 14 }],
      result: playerAttackResult,
      boundary: null,
    });
    executeAuthoritativeCombatIntent.mockResolvedValue({
      currentParticipant: { id: 'npc1', name: 'Balthazar' },
    });
    chatWithDM.mockResolvedValue({ text: 'Steel rings.', narrationSegments: [] });
  });

  it('two actors, player first: R1, R1, R2, R2', async () => {
    const order: Seat[] = ['player', 'npc1'];
    const [turn1, turn2] = TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES;
    const messages = [
      await playerTurn({ round: 1, order, turnIndex: 0, target: 'npc1', advance: [turn1] }),
      await playerTurn({ round: 2, order, turnIndex: 0, target: 'npc1', advance: [turn2] }),
    ];

    expect(dividersOf(messages)).toEqual([
      'Round 1 · The Seeker',
      'Round 1 · Monster npc1',
      'Round 2 · The Seeker',
      'Round 2 · Monster npc1',
    ]);
    expect(
      barRounds(
        [
          { round: 1, turnIndex: 0 },
          { round: 1, turnIndex: 1 },
          { round: 2, turnIndex: 0 },
          { round: 2, turnIndex: 1 },
        ],
        order,
      ),
    ).toEqual(['Round 1', 'Round 1', 'Round 2', 'Round 2']);
  });

  it('two actors, enemy first: the same rule', async () => {
    const order: Seat[] = ['npc1', 'player'];
    const [body] = TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES;
    /** The enemy acts at the top of `round`, so the body that carries it is stamped with it. */
    const enemyActs = (round: number) => ({
      ...body,
      results: [{ ...body.results[0], round }],
      round,
    });
    const messages = [
      await playerTurn({
        round: 1,
        order,
        turnIndex: 1,
        target: 'npc1',
        preflight: enemyActs(1),
        advance: [enemyActs(2)],
      }),
      await playerTurn({
        round: 2,
        order,
        turnIndex: 1,
        target: 'npc1',
        advance: [enemyActs(3)],
      }),
    ];

    expect(dividersOf(messages)).toEqual([
      'Round 1 · Monster npc1',
      'Round 1 · The Seeker',
      'Round 2 · Monster npc1',
      'Round 2 · The Seeker',
      'Round 3 · Monster npc1',
    ]);
    expect(
      barRounds(
        [
          { round: 1, turnIndex: 0 },
          { round: 1, turnIndex: 1 },
          { round: 2, turnIndex: 0 },
          { round: 2, turnIndex: 1 },
        ],
        order,
      ),
    ).toEqual(['Round 1', 'Round 1', 'Round 2', 'Round 2']);
  });

  it('three actors: the round goes up only after the third has acted', async () => {
    const order: Seat[] = ['npc0', 'player', 'npc2'];
    const [preflight, afterTurn1, afterTurn2] = THREE_ACTOR_PLAYER_MIDDLE_NPC_BATCHES;
    const messages = [
      await playerTurn({
        round: 1,
        order,
        turnIndex: 1,
        target: 'npc0',
        preflight,
        advance: [afterTurn1],
      }),
      await playerTurn({ round: 2, order, turnIndex: 1, target: 'npc0', advance: [afterTurn2] }),
    ];

    expect(dividersOf(messages)).toEqual([
      'Round 1 · Monster npc0',
      'Round 1 · The Seeker',
      'Round 1 · Monster npc2',
      'Round 2 · Monster npc0',
      'Round 2 · The Seeker',
      'Round 2 · Monster npc2',
      'Round 3 · Monster npc0',
    ]);
    expect(
      barRounds(
        [
          { round: 1, turnIndex: 0 },
          { round: 1, turnIndex: 1 },
          { round: 1, turnIndex: 2 },
          { round: 2, turnIndex: 0 },
        ],
        order,
      ),
    ).toEqual(['Round 1', 'Round 1', 'Round 1', 'Round 2']);
  });

  it('prints a divider only where the actor changes, inside a message and across messages', async () => {
    const order: Seat[] = ['player', 'npc1'];
    const [turn1] = TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES;
    const first = await playerTurn({
      round: 1,
      order,
      turnIndex: 0,
      target: 'npc1',
      advance: [turn1],
    });
    // A second message that repeats the last block of the first: same round, same actor, so it
    // opens without a divider.
    const repeated = {
      ...first,
      context: { combatEngineBlocks: [(first.context as any).combatEngineBlocks[1]] },
    } as ChatMessage;

    expect(dividersOf([first, repeated])).toEqual([
      'Round 1 · The Seeker',
      'Round 1 · Monster npc1',
    ]);
  });

  it('builds a card for every block, on the side of whoever acted', async () => {
    const order: Seat[] = ['player', 'npc1'];
    const message = await playerTurn({
      round: 1,
      order,
      turnIndex: 0,
      target: 'npc1',
      advance: [TWO_ACTOR_PLAYER_FIRST_NPC_BATCHES[0]],
    });

    const blocks = (message.context as any).combatEngineBlocks;
    expect(blocks.map((block: any) => block.cards.map((card: any) => card.side))).toEqual([
      ['party'],
      ['enemy'],
    ]);
  });
});
