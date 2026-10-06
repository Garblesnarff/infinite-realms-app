/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { AIService } from '@/services/ai-service';
import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { enforceCombatActionOnAttempt } from '@/services/combat/combat-zero-action-guard';
import { requestPlayerCheckRoll } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

/**
 * A mid-combat ability check the engine resolved is the turn (#2420): the DM's first reply was
 * written before the roll, so it is not narrated, the zero-action guard does not ask the DM for an
 * attack the spent action would refuse, and the turn is not a silent one.
 *
 * The handler, the check client, the roster filter and the resolution step are real. Mocked: the
 * DM, the roll popup (the player kept a natural 14) and the network edge. The check result is the
 * full output of the server's `executeCombatCheck` (`CombatCheckResult`), fields it always sets
 * included.
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
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => {
  const original = await importOriginal<Record<string, any>>();
  return {
    ...original,
    enforceCombatActionOnAttempt: vi.fn(original.enforceCombatActionOnAttempt),
  };
});
vi.mock('@/services/combat/player-roll-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPlayerCheckRoll: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    advanceNpcTurns: vi.fn(),
  },
}));

const PLAYER = {
  id: 'p1',
  name: 'The Apprentice',
  participantType: 'player',
  characterId: 'char-1',
  turnOrder: 1,
  abilityScores: { str: 16, dex: 14, cha: 12 },
};
const GOBLIN = { id: 'g1', name: 'Goblin', participantType: 'monster', turnOrder: 2 };
const ENCOUNTER = {
  id: 'encounter-1',
  phase: 'active',
  participants: [PLAYER, GOBLIN],
  currentRound: 2,
  currentTurnParticipantId: PLAYER.id,
};

/** What `executeCombatCheck` returns for a won shove: every field it always sets. */
const SHOVE_LINE =
  'Shove: 17 (nat 14+3) vs Goblin Athletics 9 — success — success, Goblin is prone';
const HIDE_LINE =
  'Hide: 16 (nat 14+2) vs passive Perception 10 — success — success, the room is hidden until it attacks or is found';
const RESTATE = 'Restate the engine numbers exactly; never contradict the outcome.';
const SHOVE_RESULT = {
  kind: 'shove',
  success: true,
  engineLine: SHOVE_LINE,
  dmEngineLine: SHOVE_LINE,
  dmFact: `The Apprentice Shove: ${SHOVE_LINE}. ${RESTATE}`,
  actorId: PLAYER.id,
  targetId: GOBLIN.id,
  conditionApplied: { participantId: GOBLIN.id, condition: 'Prone' },
  actorRoll: { d20: 14, modifier: 3, total: 17 },
  opposedBy: 9,
};
const HIDE_RESULT = {
  kind: 'hide',
  success: true,
  engineLine: HIDE_LINE,
  dmEngineLine: HIDE_LINE,
  dmFact: `The Apprentice Hide: ${HIDE_LINE}. ${RESTATE}`,
  actorId: PLAYER.id,
  actorRoll: { d20: 14, modifier: 2, total: 16 },
  opposedBy: 10,
};

/** The DM's reply, written before the roll: it already says how the shove went. */
const FIRST_PASS = 'You hurl yourself at the goblin and it crashes to the floor, helpless.';
const ATTACK = {
  actor_id: PLAYER.id,
  action_type: 'attack',
  target_ids: [GOBLIN.id],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};
/** The envelope `processDMResponse` produces on every reply. */
const PROD_RESULT = {
  combat_actions: [],
  roll_requests: [],
  combat_transition: 'none',
  map_actions: [],
  handout_actions: [],
};

const invoke = (playerMessage: string, overrides: Record<string, unknown> = {}) =>
  handleDmActionsAndTransitions({
    sessionId: 'session-1',
    characterRecord: { id: 'char-1' },
    activeEncounter: ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ENCOUNTER),
    aiContext: { gameState: {} },
    conversationHistory: [],
    playerMessage,
    playerInputOrigin: 'typed',
    result: { ...PROD_RESULT, text: FIRST_PASS, ...overrides },
  } as any);

const checkPosts = () =>
  vi
    .mocked(executeAuthoritativeCombatIntent)
    .mock.calls.filter(([, intent]) => (intent as { type: string }).type === 'check');

const narrationPayload = (): Record<string, any> => {
  const calls = vi.mocked(AIService.chatWithDM).mock.calls;
  return JSON.parse(calls[calls.length - 1][0].message);
};

describe('a mid-combat check the engine resolved is the whole turn (#2420)', () => {
  let checkResult: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    checkResult = SHOVE_RESULT;
    vi.mocked(requestPlayerCheckRoll).mockResolvedValue({ d20: 14 });
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The goblin scrabbles on the floor.',
    } as never);
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation((async (
      _id: string,
      intent: any,
    ) =>
      intent.type === 'check'
        ? checkResult
        : { currentParticipant: { id: GOBLIN.id, name: GOBLIN.name } }) as never);
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({ ok: true } as never);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [],
      transcriptLines: [],
      capReached: false,
      combatEnded: false,
      currentParticipant: { id: PLAYER.id, name: PLAYER.name, participantType: 'player' },
    } as never);
  });

  it('resolves "grapple it" against the one hostile, with the player on the roster', async () => {
    await invoke('grapple it');

    expect(checkPosts()).toHaveLength(1);
    expect(checkPosts()[0][1]).toMatchObject({
      type: 'check',
      actorId: PLAYER.id,
      checkKind: 'grapple',
      targetId: GOBLIN.id,
    });
  });

  it.each([
    ['shove the goblin', SHOVE_RESULT],
    ['hide behind the pillar', HIDE_RESULT],
  ])(
    '"%s": no guard, no attack, no silent-turn note, no first-pass prose',
    async (message, result) => {
      checkResult = result;

      const outcome = await invoke(message, { combat_actions: [ATTACK] });

      expect(checkPosts()).toHaveLength(1);
      // The guard that would ask the DM for an attack the spent action refuses never runs.
      expect(enforceCombatActionOnAttempt).not.toHaveBeenCalled();
      // The DM's own attack for the player is dropped: the check already spent the action.
      expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
      const payload = narrationPayload();
      expect(payload).not.toHaveProperty('silentPlayerTurnNote');
      expect(payload.authoritativeCheckResult).toEqual({
        engineLine: (result as { engineLine: string }).engineLine,
        fact: (result as { dmFact: string }).dmFact,
      });
      // The first-pass prose is neither narrated nor shown.
      const calls = vi.mocked(AIService.chatWithDM).mock.calls;
      expect(JSON.stringify(calls)).not.toContain('helpless');
      expect(outcome.responseText).not.toContain('helpless');
      expect(outcome.result.text).not.toContain('helpless');
      expect(outcome.localNotices?.map((notice) => notice.text)).toContain(
        `⚙️ Engine: ${(result as { engineLine: string }).engineLine}`,
      );
    },
  );

  it('ends the player’s turn and runs the NPC turns, as after any accepted player action', async () => {
    await invoke('shove the goblin');

    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'encounter-1',
      { type: 'end_turn', actorId: PLAYER.id },
      'dm',
    );
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-1', GOBLIN.id);
  });

  it('on a Hard campaign the DM is sent the line without the DC; the player keeps theirs', async () => {
    const PARLEY_LINE =
      'Persuasion: 21 (nat 20+1) vs DC 15 — success — success, Goblin is parley: it holds its next action';
    checkResult = {
      ...SHOVE_RESULT,
      kind: 'persuade',
      engineLine: PARLEY_LINE,
      dmEngineLine: PARLEY_LINE.replace(' vs DC 15', ''),
      dmFact: 'The Apprentice Persuasion check 21: success. PARLEY: Goblin holds its next action.',
    };

    const outcome = await invoke('talk it down');

    expect(narrationPayload().authoritativeCheckResult.engineLine).not.toContain('DC');
    expect(outcome.localNotices?.map((notice) => notice.text)).toContain(
      `⚙️ Engine: ${PARLEY_LINE}`,
    );
  });

  it('a refused end of turn after a resolved check does not throw the turn away', async () => {
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation((async (
      _id: string,
      intent: any,
    ) => {
      if (intent.type === 'check') return SHOVE_RESULT;
      throw new CombatIntentRefusedError('Action already used', 422, { reason: 'x' });
    }) as never);

    const outcome = await invoke('shove the goblin');

    expect(outcome.localNotices?.map((notice) => notice.text)).toContain(
      `⚙️ Engine: ${SHOVE_LINE}`,
    );
  });

  it('an engine refusal shows its reason, costs nothing and is narrated as a turn where nothing resolved', async () => {
    const REASON =
      'The Apprentice (medium) cannot shove Goblin (huge): the target can be no more than one size larger.';
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation((async (
      _id: string,
      intent: any,
    ) => {
      if (intent.type === 'check') {
        throw new CombatIntentRefusedError(REASON, 422, { reason: 'check_target_too_large' });
      }
      return { currentParticipant: { id: GOBLIN.id, name: GOBLIN.name } };
    }) as never);

    const outcome = await invoke('shove the goblin', { combat_actions: [ATTACK] });

    expect(outcome.localNotices?.map((notice) => notice.text)).toContain(`⚙️ Engine: ${REASON}`);
    // The guard does not ask the DM for an attack in the place of the refused shove.
    expect(enforceCombatActionOnAttempt).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    // The turn stays the player's: no end_turn, no NPC turns.
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalledWith(
      'encounter-1',
      { type: 'end_turn', actorId: PLAYER.id },
      'dm',
    );
    expect(userDataApi.advanceNpcTurns).not.toHaveBeenCalled();
    // Narrated as a turn that resolved nothing, never from the first-pass prose.
    expect(narrationPayload()).toHaveProperty('silentPlayerTurnNote');
    expect(narrationPayload()).not.toHaveProperty('authoritativeCheckResult');
    expect(JSON.stringify(vi.mocked(AIService.chatWithDM).mock.calls)).not.toContain('helpless');
    expect(outcome.responseText).not.toContain('helpless');
  });

  it('leaves an ordinary typed message to the guard and the silent-turn path', async () => {
    await invoke('I look around the room.');

    expect(checkPosts()).toHaveLength(0);
    expect(enforceCombatActionOnAttempt).toHaveBeenCalled();
    expect(narrationPayload()).toHaveProperty('silentPlayerTurnNote');
    expect(narrationPayload()).not.toHaveProperty('authoritativeCheckResult');
  });
});
