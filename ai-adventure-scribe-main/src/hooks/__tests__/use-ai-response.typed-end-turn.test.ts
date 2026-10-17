/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #784 — the typed end-of-turn, through the real client path.
 *
 * The DM model cannot emit `end_turn`, so a typed "I end my turn." that was routed through it came
 * back as a non-action and the engine answered "that was not a combat action" while the turn stayed
 * open. Here the typed phrase is driven through `useAIResponse` with the same wiring as
 * `use-ai-response.ordinary-turn-engine-lines.test.ts`: the hook, the combat refresh, the real
 * `executeAuthoritativeCombatIntent` that POSTs the intent, and the server-delivered rows. Only the
 * HTTP edges and the DM model are stubbed.
 *
 * The intent body asserted below is the one the End turn button posts and the one
 * `server-bun/src/routes/v1/combat/__tests__/intent-diagnosability.test.ts` carries through the real
 * route schema.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../shared/npc-engine-message';
import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import { useCombat } from '@/contexts/CombatContext';
import { AIService } from '@/services/ai-service';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'combat', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
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
    enterCombat: vi.fn(),
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

/** The board with the player holding the turn: this is the state the End turn option appears in. */
const encounterHeldByPlayer = {
  id: 'enc-1',
  phase: 'active',
  currentTurnParticipantId: 'scholar-1',
  currentRound: 2,
  participants,
};

/** The swing Emil takes on the player's End turn, as the server's runner returns it (#2658). */
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

const emilRow = (() => {
  const npcResult = emilSwing.results[0];
  const message = buildNpcEngineMessage(
    [
      { id: 'emil-1', name: 'Professor Emil Darkwater', participantType: 'npc' },
      { id: 'scholar-1', name: 'The Scholar', participantType: 'player', maxHp: 7 },
    ],
    encounterHeldByPlayer.currentRound,
    {
      type: npcResult.action.action_type,
      actorId: npcResult.action.actor_id,
      targetIds: npcResult.action.target_ids,
    },
    npcResult.engineResult,
  );
  const actionId = `enc-1:2:emil-1:attack`;
  return {
    id: 'npc-row-emil',
    sequence: 100,
    text: message.text,
    kind: 'npc',
    actionId,
    sessionId: DECLARED_ATTACK_SESSION_ID,
    timestamp: new Date().toISOString(),
    context: {
      ...message.context,
      npcResult: npcResult.engineResult,
      combatEncounterId: 'enc-1',
      actionId,
    },
  };
})();

describe('useAIResponse: the typed end-of-turn (#784)', () => {
  let sent: Array<Record<string, any>>;
  let npcRows: Array<{ text: string }>;
  let capture: (event: Event) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    sent = [];
    npcRows = [];
    capture = (event: Event) => {
      npcRows.push(...((event as CustomEvent).detail as Array<{ text: string }>));
    };

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: encounterHeldByPlayer },
      refreshCombatState: vi.fn(async () => encounterHeldByPlayer),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: DECLARED_ATTACK_SESSION_ID,
      campaign_id: 'camp-1',
      character_id: declaredAttackCharacter.id,
      campaign: { id: 'camp-1' },
      character: declaredAttackCharacter,
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'You offer the potion to Mira.',
      roll_requests: [],
      combat_actions: [],
    } as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        sent.push(body);
        if (body.intent?.type === 'end_turn') {
          // The intent route's body: the server ran the creatures before it answered (#2658).
          const engineRows = [emilRow];
          const npcTurns = { ...emilSwing, engineRows };
          return new Response(
            JSON.stringify({
              accepted: true,
              result: { ...encounterHeldByPlayer, npcTurns, engineRows },
              engineRows,
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ result: {} }), { status: 200 });
      }),
    );
    window.addEventListener('session-engine-rows', capture);
  });

  afterEach(() => {
    window.removeEventListener('session-engine-rows', capture);
    vi.unstubAllGlobals();
  });

  const play = (text: string): ReturnType<ReturnType<typeof useAIResponse>['getAIResponse']> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [{ text, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
    );
  };

  it('advances the turn on the End turn intent and never calls the DM', async () => {
    const response = await play('I end my turn.');

    // The DM model is never asked: the turn boundary is not something it can emit.
    expect(AIService.chatWithDM).not.toHaveBeenCalled();

    // The exact body the End turn button posts, through the real executor.
    const endTurns = sent.filter((body) => body.intent?.type === 'end_turn');
    expect(endTurns).toHaveLength(1);
    expect(endTurns[0]).toEqual({
      intent: { type: 'end_turn', actorId: 'scholar-1', actionId: expect.any(String) },
      source: 'player',
    });

    // The creatures that follow come back on the same response as server-written rows.
    expect(npcRows).toHaveLength(1);
    expect(npcRows[0].text).toContain('Professor Emil Darkwater');

    // No DM text: the engine rows are the turn's visible output.
    expect(response.text).toBe('');
  });

  it('does not treat a longer action as an end-of-turn', async () => {
    await play('I pass the potion to Mira');

    expect(AIService.chatWithDM).toHaveBeenCalled();
    expect(sent.some((body) => body.intent?.type === 'end_turn')).toBe(false);
  });
});
