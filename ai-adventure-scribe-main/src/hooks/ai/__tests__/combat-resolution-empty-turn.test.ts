/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as CombatActionExecutor from '@/services/combat/combat-action-executor';

/**
 * #2641 item 3 (run D9): "DM message 19 was empty; the enemy turn then stalled for 60+ s until the
 * player typed a nudge."
 *
 * The resolution pass hands the reply back as `narration.text` plus the engine lines it printed.
 * When the NPC lines were already put on screen (`npcLinesShown`) and a creature still holds the
 * turn (the engine paused the loop at its safety cap), the narration is the only text left, and a
 * narration that comes back empty went out as an empty reply: nothing for the player to read and
 * no word of whose turn it is.
 *
 * Real: `resolveDeclaredCombatActions`. Stubbed: the DM call. The DM envelope is the full shape
 * `processDMResponse` always sets, and the NPC batch is the full `AdvanceNpcTurnsResponse` the
 * server returns when its loop stops at the cap.
 */

const chatWithDM = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({ repairRefusedCombatAction: vi.fn() }));
const executeStructuredCombatActionWithBoundary = vi.fn();
const executeAuthoritativeCombatIntent = vi.fn();
const advanceNpcTurns = vi.fn();
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<typeof CombatActionExecutor>()),
  executeStructuredCombatActionWithBoundary: (...args: any[]) =>
    executeStructuredCombatActionWithBoundary(...args),
  executeAuthoritativeCombatIntent: (...args: any[]) => executeAuthoritativeCombatIntent(...args),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { advanceNpcTurns: (...args: any[]) => advanceNpcTurns(...args) },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const PLAYER_ID = 'the-veteran';
const MONK_ID = 'the-silent-monk-1';
const PARTICIPANTS = [
  { id: PLAYER_ID, name: 'The Veteran', participantType: 'player' },
  { id: MONK_ID, name: 'The Silent Monk 1', participantType: 'monster' },
];

/** The server's reply when the NPC loop stopped at its safety cap with a creature still up. */
const CAPPED_NPC_BATCH = {
  results: [
    {
      action: {
        actor_id: MONK_ID,
        action_type: 'attack',
        target_ids: [PLAYER_ID],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      round: 3,
      outcomes: [],
      actorIsPlayer: false,
      transcriptLines: [],
    },
  ],
  currentParticipant: { id: MONK_ID, name: 'The Silent Monk 1', participantType: 'monster' },
  round: 3,
  combatEnded: false,
  iterationCount: 6,
  iterationCap: 6,
  capReached: true,
  transcriptLines: ['⚙️ Engine: NPC turn loop stopped after 6 iterations.'],
};

/** What `processDMResponse` hands back for a DM reply that said nothing. */
const EMPTY_DM_REPLY = {
  text: '',
  options: undefined,
  combat_transition: 'none',
  roll_requests: [],
  dice_rolls: [],
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combat_actions: [],
  combatants: [],
};

describe('a combat turn never goes out with nothing in it (#2641)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue(EMPTY_DM_REPLY);
  });

  it('names whose turn it is when the narration is empty and a creature holds the turn', async () => {
    const result = await resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [],
      declarationText: '',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      combatRound: 3,
      preResolvedNpcTurns: CAPPED_NPC_BATCH as any,
      npcLinesShown: true,
    });

    expect(result.text.trim()).not.toBe('');
    expect(result.text).toContain('The Silent Monk 1');
  });

  it('does not say a creature acts next when the downed player holds the turn', async () => {
    const result = await resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [],
      declarationText: '',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      combatRound: 3,
      preResolvedNpcTurns: {
        ...CAPPED_NPC_BATCH,
        currentParticipant: {
          id: PLAYER_ID,
          name: 'The Veteran',
          participantType: 'player',
          vitalState: 'dying',
        },
      } as any,
      npcLinesShown: true,
    });

    expect(result.text).not.toContain('acts next');
  });

  it('leaves a narrated turn exactly as the DM wrote it', async () => {
    chatWithDM.mockResolvedValue({ ...EMPTY_DM_REPLY, text: 'The monk circles you.' });
    const result = await resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [],
      declarationText: '',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      combatRound: 3,
      preResolvedNpcTurns: CAPPED_NPC_BATCH as any,
      npcLinesShown: true,
    });

    expect(result.text).toBe('The monk circles you.');
  });
});

/**
 * The same cap, on the path the engine runs after the player's own action. The server's NPC loop
 * stops at its safety cap with a creature up and has no auto-advance, so the reply path asks again
 * (a few times at most) instead of leaving the creature waiting for the player to type.
 */
describe('the NPC loop stopping at its safety cap does not strand the turn (#2641)', () => {
  const MONK = { id: MONK_ID, name: 'The Silent Monk 1', participantType: 'monster' };
  const PLAYER = { id: PLAYER_ID, name: 'The Veteran', participantType: 'player' };
  const batch = (overrides: Record<string, unknown>) => ({
    results: [],
    currentParticipant: PLAYER,
    round: 3,
    combatEnded: false,
    iterationCount: 1,
    iterationCap: 6,
    capReached: false,
    transcriptLines: [],
    ...overrides,
  });
  const dodge = {
    actor_id: PLAYER_ID,
    action_type: 'dodge',
    target_ids: [],
    weapon_id: null,
    spell_id: null,
    slot_level: null,
    movement_feet: 0,
  };
  const resolve = () =>
    resolveDeclaredCombatActions({
      encounterId: 'encounter-1',
      sessionId: 'session-1',
      combatActions: [dodge as any],
      declarationText: 'You raise your guard.',
      aiContext: { gameState: {} },
      conversationHistory: [],
      participants: PARTICIPANTS,
      combatRound: 3,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    chatWithDM.mockResolvedValue({ ...EMPTY_DM_REPLY, text: 'The monks circle.' });
    executeStructuredCombatActionWithBoundary.mockResolvedValue({
      boundary: null,
      outcomes: [],
      result: {},
    });
    executeAuthoritativeCombatIntent.mockResolvedValue({ currentParticipant: MONK });
  });

  it('asks the server again while a creature is still up, and stops at the player', async () => {
    advanceNpcTurns
      .mockResolvedValueOnce(
        batch({
          currentParticipant: MONK,
          iterationCount: 6,
          capReached: true,
          transcriptLines: ['⚙️ Engine: NPC turn loop stopped after 6 iterations.'],
        }),
      )
      .mockResolvedValueOnce(batch({}));

    await resolve();

    expect(advanceNpcTurns).toHaveBeenCalledTimes(2);
    expect(advanceNpcTurns).toHaveBeenNthCalledWith(1, 'session-1', MONK_ID);
    expect(advanceNpcTurns).toHaveBeenNthCalledWith(2, 'session-1', MONK_ID);
  });

  it('does not ask again when the first run reached the player', async () => {
    advanceNpcTurns.mockResolvedValueOnce(batch({}));

    await resolve();

    expect(advanceNpcTurns).toHaveBeenCalledTimes(1);
  });

  it('gives up after a few continuations rather than looping on a stuck loop', async () => {
    advanceNpcTurns.mockResolvedValue(
      batch({
        currentParticipant: MONK,
        iterationCount: 6,
        capReached: true,
        transcriptLines: ['⚙️ Engine: NPC turn loop stopped after 6 iterations.'],
      }),
    );

    await resolve();

    expect(advanceNpcTurns).toHaveBeenCalledTimes(4);
  });
});
