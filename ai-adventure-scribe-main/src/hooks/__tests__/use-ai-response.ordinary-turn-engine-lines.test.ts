/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2386 A1 and A2 — the two ordinary in-combat turns that #2378 (PR #2385) did not reach.
 *
 * A1: on a normal turn the NPC pre-flight runs before the DM call, so the tracker HP has already
 * moved; the NPC's line used to appear only after the DM call and the player's die prompt.
 * A2: the turn that kills the last enemy ends combat inside the engine call. The DM's narration
 * pass may ask for a post-combat check; that request must survive, and must not withhold the
 * kill line behind its popup.
 *
 * Everything from the hook down to the dice bridge is real (the same wiring as
 * `use-ai-response.entry-gate-engine-lines.test.ts`); only the HTTP edges and the DM model are
 * stubbed.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import type { LocalNotice } from '@/hooks/ai/types';

import { useCombat } from '@/contexts/CombatContext';
import { SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES } from '@/hooks/ai/silent-player-turn';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'combat', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
  getAccessToken: vi.fn(() => 'test'),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    detectDeclaredAttack: vi.fn(),
    advanceNpcTurns: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    fetchSessionFallenState: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/voice-consistency-service', () => ({
  voiceConsistencyService: {
    getSessionVoiceContext: vi.fn().mockResolvedValue({ knownCharacters: {} }),
    processVoiceAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/hooks/ai/game-phase-updater', () => ({
  updateGamePhase: vi.fn(),
  clampCombatIntentFlags: vi.fn((start, end) => ({
    shouldStartCombat: start,
    shouldEndCombat: end,
  })),
}));
vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const PLAYER_INPUT = 'I swing my staff at Professor Emil Darkwater';

const participants = [
  {
    id: 'emil-1',
    name: 'Professor Emil Darkwater',
    participantType: 'npc',
    turnOrder: 0,
    initiative: 7,
    isActive: true,
  },
  {
    id: 'scholar-1',
    characterId: declaredAttackCharacter.id,
    name: 'The Scholar',
    participantType: 'player',
    turnOrder: 1,
    initiative: 3,
    isActive: true,
  },
];
const encounterHeldBy = (participantId: string): Record<string, unknown> => ({
  id: 'enc-1',
  phase: 'active',
  currentTurnParticipantId: participantId,
  currentRound: 2,
  participants,
});

/** What Emil's swing returns from `advance-npc-turns`: the same shape as the #2385 fixture. */
const emilSwing = {
  results: [
    {
      action: {
        actor_id: 'emil-1',
        action_type: 'attack',
        target_ids: ['scholar-1'],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      outcomes: [],
      engineResult: {
        actorName: 'Professor Emil Darkwater',
        targetName: 'The Scholar',
        d20: 14,
        attackBonus: 3,
        totalAttackRoll: 17,
        targetAC: 11,
        hit: true,
        finalDamage: 4,
        damageType: 'bludgeoning',
        targetNewHp: 3,
        targetCondition: 'bloodied',
        weaponResolution: { resolved: 'Quarterstaff', substituted: false },
      },
      actorIsPlayer: false,
      transcriptLines: [],
    },
  ],
  currentParticipant: { id: 'scholar-1', name: 'The Scholar', participantType: 'player' },
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};
const EMIL_LINE =
  '⚙️ Engine: Professor Emil Darkwater rolled 14 + 3 = 17 vs AC 11 against The Scholar with Quarterstaff — HIT. 4 bludgeoning damage. The Scholar is now at 3 HP and is bloodied.';

const noNpcTurns = {
  results: [],
  currentParticipant: { id: 'emil-1', name: 'Professor Emil Darkwater', participantType: 'npc' },
  combatEnded: false,
  iterationCount: 0,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};

/** The DM's structured declaration for the player's typed swing. */
const declaredSwing = {
  actor_id: 'scholar-1',
  action_type: 'attack',
  target_ids: ['emil-1'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/**
 * A last kill as the server sends it: `combat-attack-service` result fields (a dead target reads
 * `near death` from `healthConditionForCombat`), plus the `combatEnded: true` that
 * `combat-intent-service` adds.
 */
const killingBlow = {
  actorName: 'The Scholar',
  targetName: 'Professor Emil Darkwater',
  d20: 18,
  attackBonus: 5,
  totalAttackRoll: 23,
  targetAC: 12,
  hit: true,
  finalDamage: 9,
  damageType: 'bludgeoning',
  targetNewHp: 0,
  targetIsConscious: false,
  targetIsDead: true,
  targetCondition: 'near death',
  weaponResolution: { resolved: 'Quarterstaff', substituted: false },
  combatEnded: true,
};
const KILL_LINE =
  '⚙️ Engine: The Scholar rolled 18 + 5 = 23 vs AC 12 against Professor Emil Darkwater with Quarterstaff — HIT. 9 bludgeoning damage. Professor Emil Darkwater is dead.';

const POST_COMBAT_CHECK = {
  type: 'skill_check' as const,
  formula: '1d20+3',
  purpose: 'Investigation check to search the study',
  dc: 12,
};

describe('useAIResponse: ordinary in-combat turns show their engine lines (#2386)', () => {
  let order: string[];
  let held: string;
  let commitResult: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    held = 'emil-1';
    commitResult = {};

    setPlayerRollHost({
      present: (spec, settle) => {
        order.push(`prompt: attack ${'weaponName' in spec ? spec.weaponName : 'other'}`);
        queueMicrotask(() => settle({ d20: 18 }));
        return { rollId: 'roll-attack', dismiss: () => {} };
      },
    });

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: null },
      // The board is gone once the last enemy dies (`held` is emptied by the killing blow).
      refreshCombatState: vi.fn(async () => (held ? encounterHeldBy(held) : null)),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: DECLARED_ATTACK_SESSION_ID,
      campaign_id: 'camp-1',
      character_id: declaredAttackCharacter.id,
      campaign: { id: 'camp-1' },
      character: declaredAttackCharacter,
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        if (body.phase === 'propose') {
          return new Response(
            JSON.stringify({
              proposal: {
                movementOnly: false,
                legal: true,
                weaponName: 'Quarterstaff',
                attackBonus: 5,
                targetAc: 12,
                advantage: false,
                disadvantage: false,
                targetLabel: 'Professor Emil Darkwater',
              },
            }),
            { status: 200 },
          );
        }
        if (body.intent?.type === 'attack') {
          if (commitResult.combatEnded) held = '';
          return new Response(JSON.stringify({ result: commitResult }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            result: { currentParticipant: { id: 'emil-1', name: 'Professor Emil Darkwater' } },
          }),
          { status: 200 },
        );
      }),
    );
  });

  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  const play = (
    onEngineNotice?: (notice: LocalNotice) => void,
    text: string = PLAYER_INPUT,
  ): ReturnType<ReturnType<typeof useAIResponse>['getAIResponse']> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [{ text, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      onEngineNotice,
    );
  };

  it('A1: prints the NPC’s pre-flight swing, with the HP it left, before the player’s die prompt', async () => {
    vi.mocked(userDataApi.advanceNpcTurns)
      .mockImplementationOnce((async () => {
        held = 'scholar-1';
        return emilSwing;
      }) as any)
      .mockResolvedValue(noNpcTurns as any);
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'Emil staggers.', roll_requests: [] } as any);

    const shown: LocalNotice[] = [];
    const response = await play((notice) => {
      order.push(`line: ${notice.text}`);
      shown.push(notice);
    });

    // HP moved in the pre-flight, so its line is on screen before the die is asked for.
    expect(order).toEqual([`line: ${EMIL_LINE}`, 'prompt: attack Quarterstaff']);
    expect(shown).toEqual([
      {
        text: EMIL_LINE,
        persist: true,
        cards: [expect.objectContaining({ kind: 'attack', line: EMIL_LINE })],
      },
    ]);
    // Shown once: the reply does not print it a second time.
    expect(response.text).not.toContain(EMIL_LINE);
    expect(response.localNotices).toBeUndefined();
  });

  it('A1: a caller that cannot show lines early still gets the NPC line once, in the reply', async () => {
    vi.mocked(userDataApi.advanceNpcTurns)
      .mockImplementationOnce((async () => {
        held = 'scholar-1';
        return emilSwing;
      }) as any)
      .mockResolvedValue(noNpcTurns as any);
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'Emil staggers.', roll_requests: [] } as any);

    const response = await play();

    expect(response.text.match(/rolled 14 \+ 3 = 17/g)).toHaveLength(1);
    expect(response.text.startsWith(EMIL_LINE)).toBe(true);
  });

  it('A2: a check the DM asks for after the killing blow survives, and the kill line is not held behind it', async () => {
    held = 'scholar-1';
    commitResult = killingBlow;
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'The professor crumples. The study falls quiet.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const shown: LocalNotice[] = [];
    const response = await play((notice) => {
      order.push(`line: ${notice.text}`);
      shown.push(notice);
    });

    // Combat ended inside the engine call, so the check is a post-combat one: the popup opens.
    expect(response.rollRequests).toEqual([POST_COMBAT_CHECK]);
    // The reply waits for that roll, so the kill line goes on screen on its own, once.
    expect(shown).toEqual([
      {
        text: KILL_LINE,
        persist: true,
        cards: [expect.objectContaining({ kind: 'attack', line: KILL_LINE })],
      },
    ]);
    expect(response.text).not.toContain(KILL_LINE);
    expect(response.context?.combatEngineBlocks).toBeUndefined();
    expect(response.context?.combatEnded).toBe(true);
  });

  it('A2: a caller that cannot show lines early keeps the kill line in the reply', async () => {
    held = 'scholar-1';
    commitResult = killingBlow;
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'The professor crumples. The study falls quiet.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const response = await play();

    expect(response.rollRequests).toEqual([POST_COMBAT_CHECK]);
    expect(response.text.startsWith(KILL_LINE)).toBe(true);
    expect(response.text.match(/rolled 18 \+ 5 = 23/g)).toHaveLength(1);
  });

  it('A1: a silent turn after a pre-flight NPC hit is not engine-free: right note, no false trailer, no fabrication flag', async () => {
    vi.mocked(userDataApi.advanceNpcTurns)
      .mockImplementationOnce((async () => {
        held = 'scholar-1';
        return emilSwing;
      }) as any)
      .mockResolvedValue(noNpcTurns as any);
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({ text: 'You look around the study.', roll_requests: [] } as any)
      .mockResolvedValueOnce({
        text: 'Emil’s staff caught you and you are wounded. You scan the shelves.',
        roll_requests: [],
      } as any);

    const shown: LocalNotice[] = [];
    const response = await play((notice) => shown.push(notice), 'I look around the study.');

    expect(shown).toEqual([
      {
        text: EMIL_LINE,
        persist: true,
        cards: [expect.objectContaining({ kind: 'attack', line: EMIL_LINE })],
      },
    ]);
    // The narration pass is told the NPC results stand, not that nothing happened to anyone,
    // and still carries them.
    const narrationCall = vi.mocked(AIService.chatWithDM).mock.calls[1][0];
    const payload = JSON.parse(narrationCall.message);
    expect(payload.silentPlayerTurnNote).toBe(SILENT_PLAYER_TURN_NOTE_WITH_ENGINE_LINES);
    expect(payload.authoritativeCombatResults).toEqual([
      expect.objectContaining({
        action: expect.objectContaining({ actor_id: 'emil-1', target_ids: ['scholar-1'] }),
        engineResult: expect.objectContaining({ finalDamage: 4, targetNewHp: 3 }),
      }),
    ]);
    // The reply says the player took no action, and does not claim nothing was rolled.
    expect(response.text).toContain('You took no combat action this turn');
    expect(response.text).not.toContain('nothing was rolled');
    expect(logger.info).not.toHaveBeenCalledWith(
      'DM_FABRICATION_SUSPECT',
      expect.objectContaining({ reason: 'silent_player_turn' }),
    );
  });

  it('A2: while combat goes on, the DM’s roll requests stay dropped under the fresh flag', async () => {
    held = 'scholar-1';
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue(noNpcTurns as any);
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'Emil staggers.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const response = await play(() => {});

    expect(response.rollRequests).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'enc-1',
      type: 'skill_check',
      purpose: POST_COMBAT_CHECK.purpose,
    });
  });

  it('A1: a pre-flight that ends combat still shows its lines, once', async () => {
    vi.mocked(userDataApi.advanceNpcTurns).mockImplementationOnce((async () => {
      held = '';
      return { ...emilSwing, combatEnded: true, currentParticipant: null };
    }) as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValueOnce({
      text: 'The professor lowers his staff.',
      roll_requests: [],
    } as any);

    const shown: LocalNotice[] = [];
    const response = await play((notice) => shown.push(notice));

    expect(shown).toEqual([
      {
        text: EMIL_LINE,
        persist: true,
        cards: [expect.objectContaining({ kind: 'attack', line: EMIL_LINE })],
      },
    ]);
    expect(response.text).not.toContain(EMIL_LINE);
    expect(response.text).toContain('The professor lowers his staff.');
    expect(response.context?.combatEnded).toBe(true);
  });

  it('#2517 D2 path: the NPC loop killing inside the player’s own turn sets the fallen state from the resolution', async () => {
    // Run D2's shape: the player holds the turn and acts; the enemy survives
    // the swing and the NPC loop inside the same resolution kills the player.
    held = 'scholar-1';
    commitResult = { ...killingBlow, combatEnded: false, targetNewHp: 1, targetIsDead: false };
    const emilKillingSwing = {
      ...emilSwing,
      results: [
        {
          ...emilSwing.results[0],
          engineResult: {
            ...emilSwing.results[0].engineResult,
            d20: 18,
            totalAttackRoll: 21,
            finalDamage: 9,
            targetNewHp: 0,
            targetIsConscious: false,
            targetIsDead: true,
            targetCondition: 'near death',
          },
        },
      ],
      currentParticipant: null,
      combatEnded: true,
      endedReason: 'party_defeated',
    };
    vi.mocked(userDataApi.advanceNpcTurns)
      .mockImplementationOnce((async () => {
        // The board is gone after the killing resolution.
        held = '';
        return emilKillingSwing;
      }) as any)
      .mockResolvedValue(noNpcTurns as any);
    // Follows the real producer: fetchSessionFallenState reads
    // character_stats.vital_state from the session load payload.
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue({
      characterId: declaredAttackCharacter.id,
      characterName: 'The Scholar',
      campaignId: 'camp-1',
      campaignName: 'Abyssal Descent',
      starterCampaignId: null,
      diedAt: '2026-10-02T14:51:00.000Z',
    } as any);
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({ text: 'Emil strikes back.', roll_requests: [] } as any);

    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(
      [{ text: PLAYER_INPUT, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
    );

    // The DM path ran (this is not the NPC-preflight path)…
    expect(AIService.chatWithDM).toHaveBeenCalled();
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalled();
    expect(userDataApi.fetchSessionFallenState).toHaveBeenCalledWith(DECLARED_ATTACK_SESSION_ID);
    // …and the fallen state came out of the resolution itself: no further
    // message send was needed to surface it.
    await waitFor(() => {
      expect(result.current.terminalDeathState).toMatchObject({ state: 'party_defeated' });
    });
    expect(result.current.terminalDeathState?.finalLines?.join('\n')).toMatch(
      /Professor Emil Darkwater rolled 18 \+ 3 = 21/,
    );
    expect(result.current.terminalDeathState?.finalLines?.join('\n')).toMatch(
      /The Scholar is (dead|now at 0 HP)/,
    );
    // The turn still completes whole (round 3): the DM narration comes back
    // for the handler to save, and the killing engine row is carried into
    // the end state via finalLines — the swap replaces a finished turn,
    // it does not truncate it.
    expect(response?.text).toContain('Emil strikes back.');
  });

  it('#2517: a victory ending the same way leaves the fallen state unset', async () => {
    held = 'scholar-1';
    commitResult = killingBlow;
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce({
        text: 'You swing your staff.',
        roll_requests: [],
        combat_actions: [declaredSwing],
      } as any)
      .mockResolvedValueOnce({
        text: 'The professor crumples. The study falls quiet.',
        roll_requests: [POST_COMBAT_CHECK],
      } as any);

    const { result } = renderHook(() => useAIResponse());
    await result.current.getAIResponse(
      [{ text: PLAYER_INPUT, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      () => {},
    );

    // The post-combat check ran and the character lives: no end state.
    expect(userDataApi.fetchSessionFallenState).toHaveBeenCalledWith(DECLARED_ATTACK_SESSION_ID);
    expect(result.current.terminalDeathState).toBeNull();
  });
});
