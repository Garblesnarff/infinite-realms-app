/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2007 — the client consumes the server's pending entry handoff, confirms intent before asking
 * for initiative, and never lets pre-entry attack prose become an outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { resolveDeclaredCombatActions } from '@/hooks/ai/combat-resolution-step';
import { SessionExpiredError } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import { enforceCombatActionOnAttempt } from '@/services/combat/combat-zero-action-guard';
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
  trackPlayerRollDismissal: async (ask: () => Promise<unknown>) => ({
    value: await ask(),
    dismissed: false,
  }),
}));
// #2233: the spell popup reads its spell and bonus from the engine's proposal.
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn().mockResolvedValue({
    movementOnly: false,
    spellId: 'fire-bolt',
    spellName: 'Fire Bolt',
    kind: 'attack',
    attackBonus: 6,
    saveDC: 14,
    targetAc: 13,
    advantage: false,
    disadvantage: false,
  }),
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
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
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

/**
 * The creatures that won initiative, run by `/enter` before it answered (#2658 step 3), in the
 * shape the server's drain returns (`NpcTurnsDrained` = the runner's AdvanceNpcTurnsResult).
 */
const ENTRY_NPC_TURNS = {
  results: [],
  currentParticipant: {
    id: 'storyteller-1',
    name: 'The Storyteller',
    participantType: 'player',
    vitalState: 'standing',
  },
  round: 1,
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: ['⚙️ Engine: Vance misses.'],
  engineRows: [],
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

const SPELL_ACTION = {
  actor_id: 'storyteller-1',
  action_type: 'cast_spell',
  target_ids: ['vance-1'],
  weapon_id: null,
  spell_id: 'fire-bolt',
  slot_level: null,
  movement_feet: 0,
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
    // clearAllMocks keeps queued once-implementations; a test that queues one and never calls
    // the guard (#2380) must not hand it to the next test.
    vi.mocked(enforceCombatActionOnAttempt).mockReset().mockResolvedValue(null);
    vi.mocked(requestPlayerInitiativeRoll).mockResolvedValue({ d20: 16 });
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 17 });
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(true);
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' } }) as any,
    );
    vi.mocked(userDataApi.setPendingCombatIntent).mockResolvedValue(response() as any);
    vi.mocked(userDataApi.clearPendingCombatIntent).mockResolvedValue(response() as any);
    vi.mocked(resolveDeclaredCombatActions).mockResolvedValue({
      text: 'Vance acts first.',
      narrationSegments: [],
    } as any);
  });

  it('never issues a combat start, even on the exact envelope that used to trigger one', async () => {
    await invoke({ combat_transition: 'start', scene_spec: { environment: 'tavern' } });
  });

  // Migrated (#2658 step 3): was "confirms before initiative, drains the NPC turn, then resolves the queued player action"
  it('confirms before initiative, takes the creatures /enter already ran, then resolves the queued player action', async () => {
    const order: string[] = [];
    vi.mocked(requestCombatEntryConfirmation).mockImplementation(async () => {
      order.push('confirmation');
      return true;
    });
    vi.mocked(requestPlayerInitiativeRoll).mockImplementation(async () => {
      order.push('initiative');
      return { d20: 16 };
    });
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        first_action: FIRST_ACTION,
        npcTurns: ENTRY_NPC_TURNS,
      }) as any,
    );
    // The server ran Vance inside `/enter`: the one refresh already reads the player's turn.
    const refresh = vi.fn().mockResolvedValueOnce(PLAYER_TURN_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [NPC_ACTION],
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
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId: 'encounter-1',
        combatActions: [FIRST_ACTION_COMBAT_ACTION],
        participants: PLAYER_TURN_ENCOUNTER.participants,
        preResolvedNpcTurns: ENTRY_NPC_TURNS,
      }),
    );
    expect(userDataApi.setPendingCombatIntent).not.toHaveBeenCalled();
    expect(outcome.activeEncounter).toEqual(PLAYER_TURN_ENCOUNTER);
  });

  it('marks entry confirmation and initiative prompts as player waits', async () => {
    const waits: boolean[] = [];
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(NPC_TURN_ENCOUNTER)
      .mockResolvedValueOnce(PLAYER_TURN_ENCOUNTER);

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [NPC_ACTION],
      },
      refresh,
      { onPlayerWaitChange: (waiting: boolean) => waits.push(waiting) },
    );

    expect(waits).toEqual([true, false, true, false]);
  });

  it('keeps similarly named roster members in the other-combatants line', async () => {
    await invoke({
      combat_transition: 'none',
      combat_entry_pending: {
        ...PENDING_ENTRY,
        combatants: [
          { name: 'Goblin', count: 1 },
          { name: 'Goblin 2', count: 1 },
          { name: 'Goblin Shaman', count: 1 },
        ],
        declaredAttack: {
          verb: 'strike',
          actorName: 'Goblin',
          attackSource: 'unarmed',
        },
      },
    });

    expect(requestCombatEntryConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        combatantLabels: ['Goblin', 'Goblin 2', 'Goblin Shaman'],
        declaredTargets: ['Goblin'],
        otherCombatants: ['Goblin Shaman'],
      }),
    );
  });

  // Migrated (#2658 step 3): was "fails closed when the entry pre-flight rejects"
  it('a creature still holding the turn after /enter does not block the first action: the server runs it first', async () => {
    // A failed server drain leaves no `npcTurns` on the body and the creature still up; the
    // intent route runs it before the player's action, so the client neither stalls nor advances.
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' }, first_action: FIRST_ACTION }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(NPC_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [NPC_ACTION],
      },
      refresh,
    );

    // No fail-closed notice of any kind: nothing failed on the client, it just hands the action on.
    expect(outcome.localNotice).toBeUndefined();
    expect(outcome.localNotices).toBeUndefined();
    // Not yet the player's turn on this board, so no die is asked for here; the action still
    // goes to the engine, which runs the creature first.
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        combatActions: [FIRST_ACTION_COMBAT_ACTION],
        preResolvedNpcTurns: undefined,
      }),
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // Migrated (#2658 step 3): was "does not open the entry attack popup or execute when pre-flight ends combat"
  it('does not open the entry attack popup or execute when the creatures /enter ran ended combat', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        first_action: FIRST_ACTION,
        npcTurns: {
          ...ENTRY_NPC_TURNS,
          currentParticipant: null,
          combatEnded: true,
          endedReason: 'party_defeated',
          transcriptLines: ['⚙️ Engine: Vance falls.'],
        },
      }) as any,
    );
    const refresh = vi.fn().mockResolvedValueOnce(PLAYER_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [PLAYER_ACTION],
      },
      refresh,
    );

    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).not.toHaveBeenCalled();
    expect(outcome.result.combat_actions).toEqual([]);
  });

  // Migrated (#2658 step 3): was "clears a legacy pending intent before resolving exactly one entry action"
  it('leaves a pending intent to its confirmation and resolves exactly one entry action', async () => {
    const pendingIntent = {
      actorId: 'storyteller-1',
      actionType: 'attack',
      targetIds: ['vance-1'],
      sourceText: 'I punch Vance',
      queuedOnTurn: 1,
      queuedOnRound: 1,
    };
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' }, first_action: FIRST_ACTION }) as any,
    );
    const refresh = vi.fn().mockResolvedValueOnce({ ...PLAYER_TURN_ENCOUNTER, pendingIntent });

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [],
      },
      refresh,
    );

    // The client no longer discards it: that was the preflight's job, and the preflight is gone.
    expect(userDataApi.clearPendingCombatIntent).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).toHaveBeenCalledTimes(1);
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({ queuedIntentActorIds: ['storyteller-1'] }),
    );
  });

  it('opens a Fire Bolt spell-attack popup from /enter first_action', async () => {
    const spellAction = {
      actor_id: 'storyteller-1',
      action_type: 'cast_spell',
      target_ids: ['vance-1'],
      weapon_id: null,
      spell_id: 'fire-bolt',
      slot_level: null,
      movement_feet: 0,
    };
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        first_action: {
          type: 'spell',
          actor: 'storyteller-1',
          actorLabel: 'The Storyteller',
          target: 'vance-1',
          targetLabel: 'Vance',
          source: 'spell',
          attackSource: 'spell',
          weaponId: null,
          weaponName: null,
          spellId: 'fire-bolt',
          slotLevel: null,
          combat_action: spellAction,
        },
      }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [NPC_ACTION],
      },
      refresh,
    );

    expect(requestPlayerAttackRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'spell-attack',
        weaponName: 'Fire Bolt',
        targetLabel: 'Vance',
      }),
    );
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        combatActions: [spellAction],
        playerAttackRoll: expect.objectContaining({
          action: spellAction,
          d20: 17,
          autoRolled: false,
        }),
      }),
    );
  });

  it('prompts for initiative exactly once when a spell declaration starts combat (#2234)', async () => {
    // Run M4 turn 4: "I hurl a ghostly, skeletal hand of necrotic cold … Chill Touch!"
    const spellAction = {
      actor_id: 'storyteller-1',
      action_type: 'cast_spell',
      target_ids: ['vance-1'],
      weapon_id: null,
      spell_id: 'chill-touch',
      slot_level: null,
      movement_feet: 0,
    };
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        first_action: {
          type: 'spell',
          actor: 'storyteller-1',
          actorLabel: 'The Storyteller',
          target: 'vance-1',
          targetLabel: 'Vance',
          source: 'spell',
          attackSource: 'spell',
          weaponId: null,
          weaponName: null,
          spellId: 'chill-touch',
          slotLevel: null,
          combat_action: spellAction,
        },
      }) as any,
    );

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: { ...PENDING_ENTRY, detail: 'combat_action cast_spell' },
        combat_actions: [spellAction],
      },
      vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER),
      { playerMessage: 'I hurl a ghostly, skeletal hand of necrotic cold. "Chill Touch!"' },
    );

    expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1);
    expect(requestPlayerInitiativeRoll).toHaveBeenCalledTimes(1);
    expect(userDataApi.enterCombat).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ playerInitiativeRoll: 16 }),
    );
  });

  it('withdraws the entry attack when the player dismisses its roll prompt (#2234)', async () => {
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: null, cancelled: true });
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' }, first_action: FIRST_ACTION }) as any,
    );

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [NPC_ACTION],
      },
      vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER),
    );

    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        playerAttackRoll: {
          action: FIRST_ACTION_COMBAT_ACTION,
          autoRolled: false,
          cancelled: true,
        },
      }),
    );
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

    expect(requestCombatEntryConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        declaredTargets: ['Vance'],
        otherCombatants: [],
      }),
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

  it('drops and logs a stray NPC combat action before execution or repair', async () => {
    const outcome = await invoke(
      { combat_actions: [NPC_ACTION] },
      vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER),
      { activeEncounter: PLAYER_TURN_ENCOUNTER, isInCombat: true },
    );

    expect(resolveDeclaredCombatActions).not.toHaveBeenCalled();
    expect(outcome.result.combat_actions).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'DM_NPC_ACTION_DROPPED',
      expect.objectContaining({ actorId: NPC_ACTION.actor_id, encounterId: 'encounter-1' }),
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
    // #2569: the seated_without_actions notice path logs the status too.
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_DECLARE_ACTION_NOTICE', {
      reason: 'absent',
      path: 'seated_without_actions',
      encounterId: 'encounter-1',
    });
    expect(outcome.result.combat_actions).toEqual([]);
  });

  // Migrated (#2658 step 3): was "keeps the declared first_action when the player wins initiative: explicit roll, no NPC drain (#2551)"
  it('keeps the declared first_action when the player wins initiative: explicit roll, no creature turns (#2551)', async () => {
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
            verb: 'attack',
            actorName: 'Vance',
            attackSource: 'weapon',
            weaponName: 'quarterstaff',
          },
        },
        combat_actions: [],
      },
      refresh,
    );

    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({ preResolvedNpcTurns: undefined }),
    );
    expect(requestPlayerAttackRoll).toHaveBeenCalledWith(
      expect.objectContaining({ weaponName: 'Unarmed Strike', attackBonus: 5 }),
    );
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        combatActions: [FIRST_ACTION_COMBAT_ACTION],
        playerAttackRoll: { action: FIRST_ACTION_COMBAT_ACTION, d20: 17, autoRolled: false },
      }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      'COMBAT_ENTRY_FIRST_ACTION_UNUSABLE',
      expect.anything(),
    );
  });

  // Migrated (#2658 step 3): was "keeps the declared first_action when the monster acts first: NPC drains, then the explicit roll (#2551)"
  it('keeps the declared first_action when the monster acts first: /enter ran it, then the explicit roll (#2551)', async () => {
    const order: string[] = [];
    vi.mocked(userDataApi.enterCombat).mockImplementation(async () => {
      order.push('enter-with-npc-turns');
      return response({
        encounter: { id: 'encounter-1' },
        first_action: FIRST_ACTION,
        npcTurns: ENTRY_NPC_TURNS,
      }) as any;
    });
    vi.mocked(requestPlayerAttackRoll).mockImplementation(async () => {
      order.push('attack-roll');
      return { d20: 17 } as any;
    });
    const refresh = vi.fn().mockResolvedValueOnce(PLAYER_TURN_ENCOUNTER);

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: {
          ...PENDING_ENTRY,
          declaredAttack: {
            verb: 'attack',
            actorName: 'Vance',
            attackSource: 'weapon',
            weaponName: 'quarterstaff',
          },
        },
        combat_actions: [],
      },
      refresh,
    );

    expect(order).toEqual(['enter-with-npc-turns', 'attack-roll']);
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        preResolvedNpcTurns: ENTRY_NPC_TURNS,
        combatActions: [FIRST_ACTION_COMBAT_ACTION],
        playerAttackRoll: { action: FIRST_ACTION_COMBAT_ACTION, d20: 17, autoRolled: false },
      }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      'COMBAT_ENTRY_FIRST_ACTION_UNUSABLE',
      expect.anything(),
    );
  });

  it('says why when the declared weapon is not on the sheet: server notice, generic fallback, WHY logged (#2551)', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        notice:
          'You declared an attack with the quarterstaff, but it is not on your character sheet, so your opening attack was not queued.',
        first_action_refusal: { reason: 'declared_weapon_not_equipped' },
      }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: {
          ...PENDING_ENTRY,
          declaredAttack: {
            verb: 'attack',
            actorName: 'Vance',
            attackSource: 'weapon',
            weaponName: 'quarterstaff',
          },
        },
        combat_actions: [],
      },
      refresh,
    );

    expect(outcome.localNotices).toContainEqual({
      text: 'You declared an attack with the quarterstaff, but it is not on your character sheet, so your opening attack was not queued.',
      persist: true,
    });
    expect(outcome.localNotices).toContainEqual({
      text: 'Combat has begun. Declare your action.',
      persist: true,
    });
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_FIRST_ACTION_UNUSABLE', {
      reason: 'declared_weapon_not_equipped',
      status: 'refused',
      encounterId: 'encounter-1',
    });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).not.toHaveBeenCalled();
    expect(outcome.result.combat_actions).toEqual([]);
  });

  it('names the miss for a refused declared spell: specific server notice, status refused on every notice path (#2569)', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        notice:
          'You declared casting Zorblaxian Annihilation, but no such spell was recognized, so your opening spell was not queued.',
        first_action_refusal: { reason: 'declared_spell_unknown' },
      }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: {
          ...PENDING_ENTRY,
          declaredAttack: {
            verb: 'cast Zorblaxian Annihilation',
            actorName: 'Vance',
            attackSource: 'spell',
            spellName: 'Zorblaxian Annihilation',
          },
        },
        combat_actions: [],
      },
      refresh,
    );

    // The specific refusal notice, not a silent generic one.
    expect(outcome.localNotices).toContainEqual({
      text: 'You declared casting Zorblaxian Annihilation, but no such spell was recognized, so your opening spell was not queued.',
      persist: true,
    });
    // The status is computed at payload read; every notice path logs it.
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_SERVER_NOTICE', {
      reason: 'refused',
      path: 'server_notice',
      encounterId: 'encounter-1',
    });
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_DECLARE_ACTION_NOTICE', {
      reason: 'refused',
      path: 'seated_without_actions',
      encounterId: 'encounter-1',
    });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
  });

  it('logs malformed_first_action when /enter returns a first_action the client cannot use (#2551)', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({
        encounter: { id: 'encounter-1' },
        first_action: { type: 'attack' },
      }) as any,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);

    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [],
      },
      refresh,
    );

    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_FIRST_ACTION_UNUSABLE', {
      reason: 'malformed_first_action',
      status: 'malformed',
      encounterId: 'encounter-1',
    });
    // #2569: the first_action_unusable notice path logs the status too.
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_ENTRY_DECLARE_ACTION_NOTICE', {
      reason: 'malformed',
      path: 'first_action_unusable',
      encounterId: 'encounter-1',
    });
    expect(outcome.localNotices).toContainEqual({
      text: 'Combat has begun. Declare your action.',
      persist: true,
    });
    expect(requestPlayerAttackRoll).not.toHaveBeenCalled();
    expect(resolveDeclaredCombatActions).not.toHaveBeenCalled();
  });

  it('never runs the zero-action guard on a seated entry with no first_action (#2380)', async () => {
    // The real guard, not the null mock: `combat_transition: 'none'` no longer stops it, so the
    // handler has to. A typed attack on a seated entry owes "Declare your action", not a repair.
    const realGuard = (await vi.importActual('@/services/combat/combat-zero-action-guard')) as {
      enforceCombatActionOnAttempt: typeof enforceCombatActionOnAttempt;
    };
    vi.mocked(enforceCombatActionOnAttempt).mockImplementationOnce(
      realGuard.enforceCombatActionOnAttempt,
    );
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);
    const outcome = await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [],
        roll_requests: [],
      },
      refresh,
      { playerMessage: 'I attempt to punch Vance', playerInputOrigin: 'typed' },
    );

    expect(enforceCombatActionOnAttempt).not.toHaveBeenCalled();
    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(outcome.localNotices).toContainEqual({
      text: 'Combat has begun. Declare your action.',
      persist: true,
    });
    expect(outcome.result.combat_actions).toEqual([]);
  });

  it('does not treat a typed message on an entry turn as a silent turn (#2342)', async () => {
    const refresh = vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER);
    await invoke(
      { combat_transition: 'none', combat_entry_pending: PENDING_ENTRY, combat_actions: [] },
      refresh,
      { playerMessage: 'I try to talk the elemental down.', playerInputOrigin: 'typed' },
    );

    expect(resolveDeclaredCombatActions).not.toHaveBeenCalledWith(
      expect.objectContaining({ silentPlayerTurn: expect.anything() }),
    );
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

  // #2530: a roll request that never reaches the player is logged with its type, never its text.
  it('logs the type of each roll request a declined entry discards', async () => {
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(false);

    await invoke({
      combat_transition: 'none',
      combat_entry_pending: PENDING_ENTRY,
      combat_actions: [PLAYER_ACTION],
      roll_requests: [
        { type: 'initiative', formula: '1d20+2', purpose: 'Initiative' },
        { type: 'attack', formula: '1d20+5', purpose: 'Punch Vance' },
      ],
    });

    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_CLEARED', {
      reason: 'entry_declined',
      type: 'initiative',
    });
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_CLEARED', {
      reason: 'entry_declined',
      type: 'attack',
    });
  });

  it('logs the attack and initiative requests a seated entry hands to the engine, not the check', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(
      response({ encounter: { id: 'encounter-1' }, first_action: FIRST_ACTION }) as any,
    );
    const refresh = vi
      .fn()
      .mockResolvedValueOnce(NPC_TURN_ENCOUNTER)
      .mockResolvedValueOnce(PLAYER_TURN_ENCOUNTER);

    await invoke(
      {
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        roll_requests: [
          { type: 'initiative', formula: '1d20+2', purpose: 'Initiative' },
          { type: 'attack', formula: '1d20+5', purpose: 'Punch Vance' },
          { type: 'skill_check', formula: '1d20+3', purpose: 'Perception' },
        ],
      },
      refresh,
    );

    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_CLEARED', {
      reason: 'entry_seated',
      type: 'initiative',
    });
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_CLEARED', {
      reason: 'entry_seated',
      type: 'attack',
    });
    expect(logger.warn).not.toHaveBeenCalledWith(
      'DM_ROLL_REQUEST_CLEARED',
      expect.objectContaining({ type: 'skill_check' }),
    );
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

  it('keeps a declined entry as a visible non-empty line', async () => {
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(false);
    const outcome = await invoke({
      combat_transition: 'none',
      combat_entry_pending: PENDING_ENTRY,
    });
    expect(outcome.localNotice).toBeTruthy();
  });

  it('propagates a refused /enter so the outer turn can offer retry recovery', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue({ error: 'unavailable' }),
    } as any);

    await expect(
      invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY }),
    ).rejects.toMatchObject({
      name: 'CombatEntryFailedError',
      status: 503,
    });
  });

  it('propagates a thrown /enter failure so the outer turn can offer retry recovery', async () => {
    vi.mocked(userDataApi.enterCombat).mockRejectedValue(new Error('network down'));

    await expect(
      invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY }),
    ).rejects.toThrow('network down');
  });

  it('keeps a missing confirmation host as its explicit visible line', async () => {
    const error = Object.assign(new Error('Combat entry confirmation UI is unavailable'), {
      name: 'CombatEntryConfirmationUnavailableError',
      code: 'COMBAT_ENTRY_CONFIRMATION_HOST_UNAVAILABLE',
    });
    vi.mocked(requestCombatEntryConfirmation).mockRejectedValue(error);
    const outcome = await invoke({
      combat_transition: 'none',
      combat_entry_pending: PENDING_ENTRY,
    });
    expect(outcome.localNotice).toBeTruthy();
  });

  it('propagates a 401 from /enter as a typed session-expired error', async () => {
    vi.mocked(userDataApi.enterCombat).mockResolvedValue({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
    } as any);

    await expect(
      invoke({ combat_transition: 'none', combat_entry_pending: PENDING_ENTRY }),
    ).rejects.toBeInstanceOf(SessionExpiredError);
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

  it('runs a held entry the player already confirmed: no second popup, initiative, then the spell through the engine (#2341)', async () => {
    const order: string[] = [];
    vi.mocked(requestPlayerInitiativeRoll).mockImplementation(async () => {
      order.push('initiative');
      return { d20: 16 };
    });
    vi.mocked(userDataApi.enterCombat).mockImplementation((async () => {
      order.push('enter');
      return response({
        encounter: { id: 'encounter-1' },
        first_action: {
          type: 'spell',
          actor: 'storyteller-1',
          actorLabel: 'The Storyteller',
          target: 'vance-1',
          targetLabel: 'Vance',
          source: 'spell',
          attackSource: 'spell',
          weaponId: null,
          weaponName: null,
          spellId: 'fire-bolt',
          slotLevel: null,
          combat_action: SPELL_ACTION,
        },
      });
    }) as any);
    vi.mocked(requestPlayerAttackRoll).mockImplementation(async () => {
      order.push('spell attack roll');
      return { d20: 17 };
    });
    vi.mocked(resolveDeclaredCombatActions).mockImplementation((async () => {
      order.push('engine resolves, DM narrates the engine lines');
      return { text: 'Frost takes Vance in the chest.', narrationSegments: [] };
    }) as any);

    const outcome = await invoke(
      {
        // The held turn: no DM text exists, only the entry handoff.
        text: '',
        combat_transition: 'none',
        combat_entry_pending: PENDING_ENTRY,
        combat_actions: [],
        roll_requests: [],
      },
      vi.fn().mockResolvedValue(PLAYER_TURN_ENCOUNTER),
      { entryConfirmed: true },
    );

    expect(requestCombatEntryConfirmation).not.toHaveBeenCalled();
    expect(order).toEqual([
      'initiative',
      'enter',
      'spell attack roll',
      'engine resolves, DM narrates the engine lines',
    ]);
    expect(requestPlayerAttackRoll).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'spell-attack', attackBonus: 6 }),
    );
    expect(resolveDeclaredCombatActions).toHaveBeenCalledWith(
      expect.objectContaining({
        combatActions: [SPELL_ACTION],
        playerAttackRoll: expect.objectContaining({ d20: 17, autoRolled: false }),
      }),
    );
    expect(outcome.responseText).toBe('Frost takes Vance in the chest.');
  });
});
