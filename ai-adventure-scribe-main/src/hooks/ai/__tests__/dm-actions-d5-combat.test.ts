/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { AIService } from '@/services/ai-service';
import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { proposeAuthoritativeAttack } from '@/services/combat/combat-attack-proposal';
import { requestPlayerAttackRoll } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

/**
 * #2563, run D5 round 2: the DM envelope carried the Scholar's quarterstaff attack
 * on Light-Eater Swarm 1 AND `combat_transition: "end"`. The handler used to call
 * `endTacticalMap` before resolving, so no d20 dialog ever opened and no intent was
 * posted; the fight closed on narration with Swarm 1 alive at 4/4. Here the real
 * `askPlayerForAttackDie` runs (proposal + dice bridge faked at their boundaries)
 * and the end is evaluated only after the attack resolves.
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
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeAttack: vi.fn(),
  proposeAuthoritativeSpell: vi.fn(),
}));
vi.mock('@/services/combat/player-roll-bridge', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestPlayerAttackRoll: vi.fn(),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    resolveAoECast: vi.fn(),
    advanceNpcTurns: vi.fn(),
  },
}));

// The D5 board: engine participant ids, option label "Light-Eater Swarm 1". The
// label is display text only — resolution addresses participants by engine id.
const SCHOLAR_ID = 'e7e569df-0000-4000-8000-000000000001';
const SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';
const SWARM_2_ID = 'a0ee13a2-0000-4000-8000-000000000003';

const D5_ENCOUNTER = {
  id: 'encounter-d5',
  phase: 'active',
  currentRound: 2,
  currentTurnParticipantId: SCHOLAR_ID,
  participants: [
    {
      id: SCHOLAR_ID,
      name: 'The Scholar',
      participantType: 'player',
      currentHitPoints: 5,
      maxHitPoints: 7,
    },
    {
      id: SWARM_1_ID,
      name: 'Light-Eater Swarm 1',
      participantType: 'monster',
      currentHitPoints: 4,
      maxHitPoints: 4,
    },
    {
      id: SWARM_2_ID,
      name: 'Light-Eater Swarm 2',
      participantType: 'monster',
      currentHitPoints: 0,
      maxHitPoints: 4,
    },
  ],
};

const invokeD5 = (): Promise<any> =>
  handleDmActionsAndTransitions({
    sessionId: 'session-d5',
    characterRecord: { id: 'char-scholar' },
    activeEncounter: D5_ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(D5_ENCOUNTER),
    aiContext: { gameState: { tacticalContext: '' } },
    conversationHistory: [],
    playerMessage: 'I attack with Quarterstaff against Light-Eater Swarm 1.',
    result: {
      text: 'Your quarterstaff strikes true.',
      roll_requests: [],
      combat_transition: 'end',
      combat_actions: [
        {
          actor_id: SCHOLAR_ID,
          action_type: 'attack',
          target_ids: [SWARM_1_ID],
          weapon_id: 'quarterstaff',
          spell_id: null,
          slot_level: null,
          movement_feet: 0,
        },
      ],
      combatants: [],
      map_actions: [],
      handout_actions: [],
    },
  } as any);

describe('run D5 round 2 through the handler (#2563)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The blow lands, and the swarm still hovers.',
    } as any);
    vi.mocked(proposeAuthoritativeAttack).mockResolvedValue({
      movementOnly: false,
      legal: true,
      weaponName: 'Quarterstaff',
      attackBonus: 1,
      targetAc: 12,
    } as any);
    vi.mocked(requestPlayerAttackRoll).mockResolvedValue({ d20: 15 } as any);
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 2, newHp: 2 }],
      boundary: null,
    } as any);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({ results: [] } as any);
    vi.mocked(userDataApi.endTacticalMap).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'combat_end_refused_live_hostiles' }),
    } as any);
  });

  it('opens the d20 dialog and posts the declare intent with the engine id before the end is evaluated', async () => {
    const outcome = await invokeD5();

    // The dialog opened on the engine's numbers, not the label's.
    expect(proposeAuthoritativeAttack).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ type: 'attack', actorId: SCHOLAR_ID, targetId: SWARM_1_ID }),
    );
    expect(requestPlayerAttackRoll).toHaveBeenCalledWith(
      expect.objectContaining({ attackBonus: 1, targetAc: 12 }),
    );
    // The commit carries the intent with the participant's engine id and the
    // player's own die.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ target_ids: [SWARM_1_ID], weapon_id: 'quarterstaff' }),
      15,
    );

    // The end was evaluated only after the attack resolved, and the 409 keeps the
    // turn in combat with the engine notice showing.
    const commitOrder = vi.mocked(executeStructuredCombatActionWithBoundary).mock
      .invocationCallOrder[0];
    const endOrder = vi.mocked(userDataApi.endTacticalMap).mock.invocationCallOrder[0];
    expect(commitOrder).toBeLessThan(endOrder);
    expect(userDataApi.endTacticalMap).toHaveBeenCalledWith('session-d5', undefined, undefined);
    expect(outcome.result.combat_transition).toBe('none');
    expect(outcome.isInCombat).toBe(true);
    const notices = JSON.stringify(outcome.localNotices ?? outcome.localNotice ?? '');
    expect(notices).toContain('fight is not over');
  });
});
