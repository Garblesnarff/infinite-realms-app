/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2007 — the client consumes the server's pending entry handoff, confirms intent before asking
 * for initiative, and never lets pre-entry attack prose become an outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { resolveDeclaredCombatActions } from '@/hooks/ai/combat-resolution-step';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import {
  requestPlayerAttackRoll,
  requestPlayerInitiativeRoll,
} from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/hooks/ai/combat-resolution-step', () => ({
  resolveDeclaredCombatActions: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  requestPlayerAttackRoll: vi.fn(),
  requestPlayerInitiativeRoll: vi.fn(),
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
  combatBoundaryFromResult: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn().mockResolvedValue({ ok: true }),
    applyDmTacticalActions: vi.fn().mockResolvedValue({ ok: true }),
    applyDmHandoutActions: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    resolveAoECast: vi.fn().mockResolvedValue({ ok: true }),
    enterCombat: vi.fn(),
    setPendingCombatIntent: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
    promotePendingCombatIntent: vi.fn(),
  },
}));
vi.mock('@/services/combat/combat-zero-action-guard', () => ({
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));

const PLAYER = {
  id: 'char-1',
  name: 'The Storyteller',
  dexterity: 14,
  currentHitPoints: 20,
  maxHitPoints: 20,
};

const ACTIVE_ENCOUNTER = {
  id: 'encounter-1',
  phase: 'active',
  currentTurnParticipantId: 'participant-0',
  currentRound: 1,
  participants: [],
};

const NPC_TURN_ENCOUNTER = {
  id: 'encounter-1',
  phase: 'active',
  currentTurnParticipantId: 'vance-1',
  currentRound: 1,
  participants: [
    {
      id: 'storyteller-1',
      characterId: 'char-1',
      name: 'The Storyteller',
      participantType: 'player',
      isActive: true,
      currentHitPoints: 20,
      isUnconscious: false,
    },
    {
      id: 'vance-1',
      name: 'Vance',
      participantType: 'npc',
      isActive: true,
      currentHitPoints: 12,
      isUnconscious: false,
    },
  ],
};

const PLAYER_TURN_ENCOUNTER = {
  ...NPC_TURN_ENCOUNTER,
  currentTurnParticipantId: 'storyteller-1',
};

const PENDING_ENTRY = {
  trigger: 'tactical_action' as const,
  detail: 'combat_action attack',
  combatants: [{ name: 'Vance', count: 1 }],
  sceneSpec: { environment: 'dungeon_room' },
  sceneSpecSynthesized: true,
};

const PLAYER_ACTION = {
  actor_id: 'the-storyteller',
  action_type: 'attack',
  target_ids: ['vance'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const NPC_ACTION = {
  actor_id: 'vance',
  action_type: 'attack',
  target_ids: ['the-storyteller'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

const FIRST_ACTION_COMBAT_ACTION = { ...PLAYER_ACTION, weapon_id: 'unarmed-strike' };

const FIRST_ACTION = {
  type: 'attack',
  actor: 'storyteller-1',
  actorLabel: 'The Storyteller',
  target: 'vance-1',
  targetLabel: 'Vance',
  source: 'unarmed',
  attackSource: 'unarmed',
  weaponId: 'unarmed-strike',
  weaponName: 'Unarmed Strike',
  spellId: null,
  slotLevel: null,
  combat_action: FIRST_ACTION_COMBAT_ACTION,
  roll_request: {
    type: 'attack',
    formula: '1d20+5',
    purpose: 'Unarmed Strike attack against Vance',
    dc: null,
    ac: 12,
    advantage: false,
    disadvantage: false,
    modifier: 5,
    actorName: 'The Storyteller',
  },
};

const MOVE_FIRST_ACTION = {
  type: 'move',
  actor: 'storyteller-1',
  actorLabel: 'The Storyteller',
  target: 'vance-1',
  targetLabel: 'Vance',
  source: 'unarmed',
  attackSource: 'unarmed',
  weaponId: 'unarmed-strike',
  weaponName: 'Unarmed Strike',
  spellId: null,
  slotLevel: null,
  reach: { inReach: false, distanceFeet: 10, movedFeetIfApproached: 30 },
  notice: 'You close 30 ft. Vance is still 10 ft away. Your turn is spent.',
  combat_action: {
    actor_id: 'storyteller-1',
    action_type: 'move',
    target_ids: [],
    weapon_id: 'unarmed-strike',
    spell_id: null,
    slot_level: null,
    movement_feet: 30,
    x: 7,
    y: 1,
  },
};

const response = (payload: Record<string, unknown> = {}) => ({
  ok: true,
  status: 201,
  json: vi.fn().mockResolvedValue(payload),
});

const invoke = (
  result: Record<string, unknown>,
  refresh = vi.fn().mockResolvedValue(null),
  overrides: Record<string, unknown> = {},
) =>
  handleDmActionsAndTransitions({
    sessionId: 'session-1',
    result: { text: 'You swing.', ...result },
    characterRecord: PLAYER,
    activeEncounter: null,
    isInCombat: false,
    refreshCombatState: refresh,
    aiContext: { gameState: {} },
    conversationHistory: [],
    playerMessage: 'I attempt to punch Vance',
    ...overrides,
  } as any);

describe('handleDmActionsAndTransitions — combat entry (#1907 PR2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requestPlayerInitiativeRoll).mockResolvedValue({ d20: 16 });
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17 });
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(true);
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' } }) as any,
    );
    vi.mocked(userDataApi.setPendingCombatIntent).mockResolvedValue(response() as any);
    vi.mocked(resolveDeclaredCombatActions).mockResolvedValue({
      text: 'Vance acts first.',
      narrationSegments: [],
    } as any);
  });

  it('never issues a combat start, even on the exact envelope that used to trigger one', async () => {
    await invoke({ combat_transition: 'start', scene_spec: { environment: 'tavern' } });
  });

  it('confirms before initiative, then seats and queues the player action when an NPC acts first', async () => {
    const order: string[] = [];
    vi.mocked(requestCombatEntryConfirmation).mockImplementation(async () => {
      order.push('confirmation');
      return true;
    });
    vi.mocked(requestPlayerInitiativeRoll).mockImplementation(async () => {
      order.push('initiative');
      return { d20: 16 };
    });
    const refresh = vi.fn().mockResolvedValue(NPC_TURN_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [PLAYER_ACTION, NPC_ACTION],
      },
      refresh,
    );

    expect(order).toEqual(['confirmation', 'initiative']);
    expect(requestCombatEntryConfirmation).toHaveBeenCalledWith({
      actorLabel: 'The Storyteller',
      combatantLabels: ['Vance'],
      initiativeRoll: null,
      initiativeModifier: 2,
    });
    expect(requestPlayerInitiativeRoll).toHaveBeenCalledWith({
      actorLabel: 'The Storyteller',
      initiativeModifier: 2,
    });
    expect(userDataApi.enterCombat).toHaveBeenCalledWith('session-1', {
      combatants: PENDING_ENTRY.combatants,
      sceneSpec: PENDING_ENTRY.sceneSpec,
      player: {
        characterId: 'char-1',
        name: 'The Storyteller',
        initiativeModifier: 2,
        hpCurrent: 20,
        hpMax: 20,
      },
      playerInitiativeRoll: 16,
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(userDataApi.setPendingCombatIntent).toHaveBeenCalledWith('encounter-1', {
      actorId: 'storyteller-1',
      actionType: 'attack',
      targetIds: ['vance'],
      sourceText: 'I attempt to punch Vance',
    });
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId: 'encounter-1',
        combatActions: [NPC_ACTION],
        participants: NPC_TURN_ENCOUNTER.participants,
      }),
    );
    expect(outcome.localNotice).toBe(
      'Your attack is declared. Vance acts first — your turn comes next.',
    );
    expect(outcome.localNotices).toEqual([
      {
        text: 'Your attack is declared. Vance acts first — your turn comes next.',
        persist: true,
      },
    ]);
  });

  it('uses /enter first_action and its engine modifier, ignoring model combat_actions', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' }, first_action: FIRST_ACTION }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: {
          ...PENDING_ENTRY,
          declaredAttack: {
            verb: 'punch',
            actorName: 'Vance',
            attackSource: 'unarmed',
          },
        },
        // This is deliberately a conflicting model action. The entry action must win.
        combat_actions: [NPC_ACTION],
      },
      refresh,
    );

    expect(requestPlayerAttackRoll).toHaveBeenCalledWith({
      actorLabel: 'The Storyteller',
      targetLabel: 'Vance',
      weaponName: 'Unarmed Strike',
      attackBonus: 5,
      targetAc: 12,
      advantage: false,
      disadvantage: false,
    });
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        combatActions: [FIRST_ACTION_COMBAT_ACTION],
        playerAttackRoll: { action: FIRST_ACTION_COMBAT_ACTION, d20: 17, autoRolled: false },
      }),
    );
    expect(resolveDeclaredCombatActions).not.toHaveBeenCalledWith(
      expect.objectContaining({ combatActions: [NPC_ACTION] }),
    );
  });

  it('resolves an out-of-reach entry as move-only without opening an attack popup', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        first_action: MOVE_FIRST_ACTION,
        notice: MOVE_FIRST_ACTION.notice,
      }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: {
          ...PENDING_ENTRY,
          declaredAttack: { verb: 'punch', actorName: 'Vance', attackSource: 'unarmed' },
        },
        combat_actions: [NPC_ACTION],
      },
      refresh,
    );

    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(outcome.localNotices).toContainEqual({
      text: MOVE_FIRST_ACTION.notice,
      persist: true,
    });
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        combatActions: [MOVE_FIRST_ACTION.combat_action],
        playerAttackRoll: undefined,
      }),
    );
  });

  it('shows the explicit declare-action notice when entry returns neither action path', async () => {
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [],
      },
      refresh,
    );

    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).not.toHaveBeenCalled();
    expect(outcome.localNotices).toContainEqual({
      text: 'Combat has begun. Declare your action.',
      persist: true,
    });
    expect(outcome.result.combat_actions).toEqual([]);
  });

  it('declines combat entry without seating an encounter or resolving the attack', async () => {
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(false);
    const refresh = vi.fn().mockResolvedValue(NPC_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        text: 'Vance catches your arm before the punch lands.',
        combat_actions: [PLAYER_ACTION],
      },
      refresh,
    );

    expect(requestCombatEntryConfirmation).toHaveBeenCalledWith({
      actorLabel: 'The Storyteller',
      combatantLabels: ['Vance'],
      initiativeRoll: null,
      initiativeModifier: 2,
    });
    expect(requestPlayerInitiativeRoll).not.toHaveBeenCalled();
    expect(userDataApi.enterCombat).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).not.toHaveBeenCalled();
    expect(outcome.activeEncounter).toBeNull();
    expect(outcome.isInCombat).toBe(false);
    expect(outcome.result.combat_actions).toEqual([]);
    expect(outcome.responseText).toBe('');
    expect(outcome.localNotice).toBe(
      'Combat entry declined. No encounter was seated; your action was not resolved.',
    );
    expect(outcome.localNotices).toEqual([
      {
        text: 'Combat entry declined. No encounter was seated; your action was not resolved.',
        persist: true,
      },
    ]);
  });

  it('does not seat or refresh when the pending handoff has no usable player character', async () => {
    const refresh = vi.fn().mockResolvedValue(NPC_TURN_ENCOUNTER);
    const outcome = await invoke(
      { combat_transition: 'none', combat_entry_pending: PENDING_ENTRY },
      refresh,
      { characterRecord: { id: 'char-1' } },
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(userDataApi.enterCombat).not.toHaveBeenCalled();
    expect(outcome.isInCombat).toBe(false);
    expect(outcome.responseText).toBe('');
    expect(outcome.localNotice).toBe('Combat entry is waiting for a valid player character.');
  });

  it('appends the server seating transcript as the visible system notice on success', async () => {
    const seatingTranscript = '⚙️ Engine: Initiative — You: 16 + 2 = 18 (you rolled).';
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' }, seatingTranscript }) as any,
    );

    const outcome = await invoke({
      combat_transition: 'none',
      combat_entry_pending: PENDING_ENTRY,
      combat_actions: [],
    });

    expect(outcome.localNotice).toBe(
      `${seatingTranscript}\nCombat has begun. Declare your action.`,
    );
    expect(outcome.localNotices).toEqual([
      { text: seatingTranscript, persist: false },
      { text: 'Combat has begun. Declare your action.', persist: true },
    ]);
    expect(outcome.responseText).toBe('');
  });

  it.each([
    [
      'decline',
      async () => {
        vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(false);
        return invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY });
      },
    ],
    [
      'non-ok /enter',
      async () => {
        vi.mocked(userDataApi.enterCombat).mockResolvedValue({
          ok: false,
          status: 503,
          json: vi.fn().mockResolvedValue({ error: 'unavailable' }),
        } as any);
        return invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY });
      },
    ],
    [
      'thrown /enter',
      async () => {
        vi.mocked(userDataApi.enterCombat).mockRejectedValue(new Error('network down'));
        return invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY });
      },
    ],
    [
      'no confirmation host',
      async () => {
        const error = Object.assign(new Error('Combat entry confirmation UI is unavailable'), {
          name: 'CombatEntryConfirmationUnavailableError',
          code: 'COMBAT_ENTRY_CONFIRMATION_HOST_UNAVAILABLE',
        });
        vi.mocked(requestCombatEntryConfirmation).mockRejectedValue(error);
        return invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY });
      },
    ],
  ])('produces a visible non-empty line for %s', async (_branch, run) => {
    const outcome = await run();
    expect(outcome.localNotice).toBeTruthy();
  });

  it('turns a missing confirmation host into its explicit visible message', async () => {
    const error = Object.assign(new Error('Combat entry confirmation UI is unavailable'), {
      name: 'CombatEntryConfirmationUnavailableError',
      code: 'COMBAT_ENTRY_CONFIRMATION_HOST_UNAVAILABLE',
    });
    vi.mocked(requestCombatEntryConfirmation).mockRejectedValue(error);

    const outcome = await invoke({
      combat_transition: 'none',
      combat_entry_pending: PENDING_ENTRY,
    });

    expect(outcome.localNotice).toBe('Combat entry could not be confirmed (no confirmation UI)');
    expect(outcome.localNotices).toEqual([
      {
        text: 'Combat entry could not be confirmed (no confirmation UI)',
        persist: true,
      },
    ]);
    expect(outcome.responseText).toBe('');
  });

  it('turns a named friendly-NPC attack into an engine entry intent, never an attack outcome (#1943)', async () => {
    const refresh = vi.fn().mockResolvedValue(NPC_TURN_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        text: 'Vance catches your arm before the punch lands.',
        combat_actions: [PLAYER_ACTION],
      },
      refresh,
    );

    expect(outcome.result.combat_entry).toMatchObject({ entered: true });
    expect(outcome.result.text).toBe('');
    expect(outcome.responseText).toBe('');
    expect(outcome.responseText).not.toContain('catches your arm');
    expect(outcome.narrationSegments).toBeUndefined();
    expect(userDataApi.setPendingCombatIntent).toHaveBeenCalledWith(
      'encounter-1',
      expect.objectContaining({ actionType: 'attack', targetIds: ['vance'] }),
    );
  });

  it('re-reads authoritative state when the server reports it seated an encounter', async () => {
    const refresh = vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'start',
        scene_spec: { environment: 'dungeon_room' },
        combat_entry: {
          entered: true,
          encounterId: 'encounter-1',
          trigger: 'attack_roll_request',
          detail: 'roll_request attack: Punch Dishwasher Prime',
          sceneSpecSynthesized: true,
        },
      },
      refresh,
    );

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(outcome.isInCombat).toBe(true);
    expect(outcome.activeEncounter).toEqual(ACTIVE_ENCOUNTER);
  });

  it('refreshes on a gated entry even if the envelope rewrite were absent', async () => {
    const refresh = vi.fn().mockResolvedValue(ACTIVE_ENCOUNTER);
    await invoke(
      {
        combat_transition: 'none',
        combat_entry: {
          entered: true,
          encounterId: 'encounter-1',
          trigger: 'tactical_action',
          detail: 'map_action forced_move -> dishwasher-prime',
          sceneSpecSynthesized: true,
        },
      },
      refresh,
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('leaves a peaceful turn alone', async () => {
    const refresh = vi.fn().mockResolvedValue(null);
    const outcome = await invoke({ combat_transition: 'none' }, refresh);
    expect(refresh).not.toHaveBeenCalled();
    expect(outcome.isInCombat).toBe(false);
  });
});
