/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { executeStructuredCombatActionWithBoundary } from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

/**
 * When the guard is allowed to fire, and when it must keep its hands off the turn.
 *
 * The guard's whole risk is over-firing: a false positive spends a generation on a turn that
 * was already correct, and — worse — could force a structured action onto a turn the DM
 * deliberately paused on the dice UI, taking the player's roll away from them. So the
 * stand-down cases below are the point of this file, not an afterthought to the firing case.
 *
 * Only the network edge is mocked; the trigger decision and the corrective prompt are the real
 * ones, and the repair is identified by the text the DM would actually receive.
 */

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
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
    resolveAoECast: vi.fn(),
  },
}));
const ACTIVE_ENCOUNTER = { id: 'encounter-1', phase: 'active' };

const TACTICAL_CONTEXT = `ACTIVE the-seeker

<turn_order round="3">
→ 1. the-seeker | The Seeker | 18/24 HP | action:available | CURRENT TURN
  2. sentient-glaze | Sentient Glaze | 30/30 HP | action:available
</turn_order>`;

const REPAIRED_ACTION = {
  actor_id: 'the-seeker',
  action_type: 'attack',
  target_ids: ['sentient-glaze'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/** The repair is the `chatWithDM` call carrying the correction, not the resolution narration. */
const repairCalls = (): any[] =>
  vi
    .mocked(AIService.chatWithDM)
    .mock.calls.filter((call) =>
      String(call[0]?.message ?? '').includes('YOUR LAST RESPONSE RESOLVED NOTHING'),
    );

const invoke = (overrides: Record<string, unknown> = {}): Promise<any> =>
  handleDmActionsAndTransitions({
    sessionId: 'session-1',
    characterRecord: { id: 'char-1' },
    activeEncounter: ACTIVE_ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER),
    aiContext: { gameState: { tacticalContext: TACTICAL_CONTEXT } },
    conversationHistory: [],
    playerMessage: 'I attack the Sentient Glaze with my claws',
    result: { text: 'Your claws rake across the glaze and skitter away.' },
    ...overrides,
  } as any);

describe('the zero-action guard inside the DM action pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: 'narrated resolution' } as any);
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [],
      boundary: null,
    });
  });

  it('fires when combat is active, the player attacked, and the DM declared nothing', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValueOnce({
      text: 'You lash out at the glaze.',
      combat_actions: [REPAIRED_ACTION],
    } as any);

    await invoke();

    expect(repairCalls()).toHaveLength(1);
    // The board the DM was shown is what it is corrected against.
    expect(repairCalls()[0][0].message).toContain('The entity whose turn it is: the-seeker.');
    // The repaired action takes the ordinary path: it is actually resolved by the engine. The
    // trailing `undefined` is the player's attack die, which this turn has none of — no roster
    // was supplied, so no actor can be shown to be the player's, and the engine rolls.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-1',
      REPAIRED_ACTION,
      undefined,
    );
  });

  it('asks exactly once, then keeps the narration when the DM still declares nothing', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'still prose',
      combat_actions: [],
    } as any);

    const outcome = await invoke();

    expect(repairCalls()).toHaveLength(1);
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    // Exactly today's behaviour, so a failed repair can never be a regression.
    expect(outcome.responseText).toBe('Your claws rake across the glaze and skitter away.');
  });

  // This used to read "stands down when the DM asked the player for a roll": the turn was taken
  // to be paused on the dice popup, and forcing an action would steal the roll. In combat there
  // is no popup. `processRollRequests` drops every DM roll request while an encounter is open
  // (#1807, #2378), so the stand-down left a typed attack with no engine action and no prompt: the
  // request vanished and the saved row kept prose alone (#2530). The request is dropped first.
  it('fires when the DM answered a typed attack with a roll request instead of an action', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValueOnce({
      text: 'You lash out at the glaze.',
      combat_actions: [REPAIRED_ACTION],
    } as any);

    const outcome = await invoke({
      result: {
        text: 'Roll to hit.',
        roll_requests: [{ type: 'attack', formula: '1d20+5', purpose: 'Claw attack' }],
      },
    });

    expect(repairCalls()).toHaveLength(1);
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-1',
      REPAIRED_ACTION,
      undefined,
    );
    expect(outcome.result.roll_requests ?? []).toEqual([]);
    // An attack request is the DM's declaration channel, dropped every combat turn: no notice.
    expect(outcome.localNotices).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'encounter-1',
      type: 'attack',
      purpose: 'Claw attack',
    });
  });

  it('tells the player a dropped saving throw was not rolled', async () => {
    const outcome = await invoke({
      playerMessage: 'I try to talk the glaze down',
      result: {
        text: 'The glaze quivers.',
        roll_requests: [{ type: 'save', formula: '1d20+2', purpose: 'Wisdom save', dc: 13 }],
      },
    });

    expect(outcome.localNotices).toEqual([
      {
        text: 'The DM asked for a saving throw roll, but dice in combat belong to the engine, so no roll was made.',
        persist: true,
      },
    ]);
  });

  it('stands down for a legacy ROLL_REQUESTS_V1 block in the narration', async () => {
    await invoke({ result: { text: 'Roll it.\n```ROLL_REQUESTS_V1\nattack\n```' } });

    expect(repairCalls()).toHaveLength(0);
  });

  it('stands down while the board itself is moving', async () => {
    await invoke({ result: { text: 'The fight begins.', combat_transition: 'start' } });

    expect(repairCalls()).toHaveLength(0);
  });

  describe('on the envelope production sends (combat_transition "none", #2380)', () => {
    // `processDMResponse` always sets these fields; the guard used to read 'none' as a transition.
    const prodResult = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      text: 'Your claws rake across the glaze and skitter away.',
      roll_requests: [],
      combat_transition: 'none',
      combat_actions: [],
      combatants: [],
      map_actions: [],
      handout_actions: [],
      ...overrides,
    });

    it('fires on a typed attack the DM answered with prose', async () => {
      vi.mocked(AIService.chatWithDM).mockResolvedValueOnce({
        text: 'You lash out at the glaze.',
        combat_actions: [REPAIRED_ACTION],
      } as any);

      await invoke({ result: prodResult() });

      expect(repairCalls()).toHaveLength(1);
      expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
        'encounter-1',
        REPAIRED_ACTION,
        undefined,
      );
    });

    it('stays quiet when the DM declared an engine action', async () => {
      await invoke({ result: prodResult({ combat_actions: [REPAIRED_ACTION] }) });

      expect(repairCalls()).toHaveLength(0);
      expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
    });

    it('stays quiet for a sheet cast the DM did not declare; the engine refuses it itself (#2304)', async () => {
      await invoke({
        playerMessage: 'I cast Chill Touch [spell_id=chill-touch, target=sentient-glaze]',
        playerInputOrigin: 'typed',
        result: prodResult(),
      });

      expect(repairCalls()).toHaveLength(0);
    });
  });

  it('stands down when the player asked a question rather than attacking', async () => {
    await invoke({ playerMessage: 'Can I attack the glaze from here?' });

    expect(repairCalls()).toHaveLength(0);
  });

  it('stands down when the turn is a submitted dice result, not a fresh attempt', async () => {
    await invoke({ isDiceRollMessage: true });

    expect(repairCalls()).toHaveLength(0);
  });

  it('stands down when the DM did declare an action', async () => {
    await invoke({ result: { text: 'You strike.', combat_actions: [REPAIRED_ACTION] } });

    expect(repairCalls()).toHaveLength(0);
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1);
  });

  it('stands down outside combat, where there is no engine turn to owe', async () => {
    await invoke({ isInCombat: false, activeEncounter: null });

    expect(repairCalls()).toHaveLength(0);
  });

  it('drops malformed handout actions before the request and logs the drop once', async () => {
    await invoke({
      isInCombat: false,
      activeEncounter: null,
      result: {
        text: 'The journal is yours.',
        handout_actions: [
          { mode: 'authored', key: 'alpha-journal', title: 'Alpha Journal', giver: 'Darkwater' },
        ],
      },
    });

    expect(userDataApi.applyDmHandoutActions).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[DMHandouts] Dropped invalid handout actions before request',
      { dropped: 1 },
    );
  });

  it('sends only valid handout actions', async () => {
    vi.mocked(userDataApi.applyDmHandoutActions).mockResolvedValueOnce(
      new Response(JSON.stringify({ entries: [] }), { status: 200 }),
    );
    const authored = {
      mode: 'authored',
      key: 'alpha-journal',
      title: 'Alpha Journal',
      body: null,
      giver: 'Professor Darkwater',
    };

    await invoke({
      isInCombat: false,
      activeEncounter: null,
      result: {
        text: 'The journal is yours.',
        handout_actions: [
          authored,
          { mode: 'authored', key: 'broken', title: 'Broken', giver: 'Darkwater' },
        ],
      },
    });

    expect(userDataApi.applyDmHandoutActions).toHaveBeenCalledWith('session-1', [authored]);
  });
});
