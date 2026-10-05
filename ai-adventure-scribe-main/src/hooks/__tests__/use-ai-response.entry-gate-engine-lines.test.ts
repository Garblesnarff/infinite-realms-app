/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2378 — run 15: "I cast Chill Touch at Professor Emil Darkwater" seated an encounter through the
 * server entry gate, the player threw the spell-attack die, and the screen showed no line for it,
 * a DM-made "Critical damage roll" 1d6 popup, and HP 7 → 1 with nothing said.
 *
 * Everything from the hook down to the dice bridge is real: `useAIResponse`,
 * `handleDmActionsAndTransitions`, `resolveDeclaredCombatActions`, `processRollRequests` with the
 * real roll-request parser, and the player-roll bridge (a fake host stands in for the popup).
 * Only the HTTP edges and the DM model are stubbed.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import type { LocalNotice } from '@/hooks/ai/types';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
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
    enterCombat: vi.fn(),
    advanceNpcTurns: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
  requestCombatEntryAnswer: vi.fn(),
}));
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn().mockResolvedValue({
    movementOnly: false,
    spellId: 'chill-touch',
    spellName: 'Chill Touch',
    kind: 'attack',
    attackBonus: 6,
    targetAc: 12,
    advantage: false,
    disadvantage: true,
    targetLabel: 'Professor Emil Darkwater',
  }),
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

const PLAYER_INPUT = 'I cast Chill Touch at Professor Emil Darkwater';

const pending = {
  trigger: 'player_intent' as const,
  detail: 'player declared an attack on Professor Emil Darkwater',
  combatants: [{ name: 'Professor Emil Darkwater', count: 1 }],
  sceneSpec: { sessionId: DECLARED_ATTACK_SESSION_ID },
  sceneSpecSynthesized: true,
  declaredAttack: {
    verb: 'cast Chill Touch',
    actorName: 'Professor Emil Darkwater',
    attackSource: 'spell' as const,
    spellId: 'chill-touch',
    spellName: 'Chill Touch',
  },
};

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
  currentRound: 1,
  participants,
});

const SEATING_LINE =
  '⚙️ Engine: Initiative: 3 (nat 2+1) — Professor Emil Darkwater: 7 + 0 = 7. You: 2 + 1 = 3.';

/** What Emil's opening quarterstaff swing returns from `advance-npc-turns`: 7 HP down to 1. */
const emilOpeningAttack = {
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
        finalDamage: 6,
        damageType: 'bludgeoning',
        targetNewHp: 1,
        targetCondition: 'near death',
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
  '⚙️ Engine: Professor Emil Darkwater rolled 14 + 3 = 17 vs AC 11 against The Scholar with Quarterstaff — HIT. 6 bludgeoning damage. The Scholar is now at 1 HP and is near death.';

/** The engine's answer to the spell-attack intent: natural 7, +6, disadvantage already applied. */
const chillTouchResult = {
  results: [
    {
      spellName: 'Chill Touch',
      actorName: 'The Scholar',
      targetName: 'Professor Emil Darkwater',
      d20: 7,
      attackBonus: 6,
      totalAttackRoll: 13,
      targetAC: 12,
      hit: true,
      finalDamage: 4,
      damageType: 'necrotic',
      targetNewHp: 3,
    },
  ],
};
const CHILL_TOUCH_LINE =
  '⚙️ Engine: The Scholar cast Chill Touch at Professor Emil Darkwater — spell attack 7 + 6 = 13 vs AC 12 — HIT. 4 necrotic damage. Professor Emil Darkwater is now at 3 HP.';

/** The DM's narration pass from run 15: an attack request and a "Critical damage roll" 1d6. */
const DM_TEXT = [
  'Cold clings to the professor and he yelps.',
  '```ROLL_REQUESTS_V1',
  JSON.stringify({
    rolls: [
      { type: 'attack', formula: '1d20+6', purpose: 'Chill Touch spell attack', ac: 12 },
      { type: 'damage', formula: '1d6', purpose: 'Critical damage roll' },
    ],
  }),
  '```',
  'The Scholar, what do you do?',
].join('\n');

describe('useAIResponse: an entry-gate encounter shows its engine lines (#2378)', () => {
  let order: string[];
  let held: string;
  let intentBodies: Array<Record<string, any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    held = '';
    intentBodies = [];

    // The dice popup: each prompt is answered with the die the player "rolled" for it.
    setPlayerRollHost({
      present: (spec, settle) => {
        const kind = 'initiativeModifier' in spec ? 'initiative' : `attack ${spec.weaponName}`;
        order.push(`prompt: ${kind}`);
        queueMicrotask(() => settle({ d20: 'initiativeModifier' in spec ? 2 : 7 }));
        return { rollId: `roll-${kind}`, dismiss: () => {} };
      },
    });

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      // No encounter until `/enter` seats one; then Emil holds the turn until his turns are drained.
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
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pending }),
    } as any);
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(true);
    vi.mocked(userDataApi.enterCombat).mockImplementation((async () => {
      held = 'emil-1';
      return {
        ok: true,
        status: 201,
        json: async () => ({
          encounter: { id: 'enc-1' },
          seatingTranscript: SEATING_LINE,
          first_action: {
            type: 'spell',
            actor: 'scholar-1',
            target: 'emil-1',
            spellId: 'chill-touch',
            slotLevel: null,
          },
        }),
      };
    }) as any);
    vi.mocked(userDataApi.advanceNpcTurns)
      .mockImplementationOnce((async () => {
        held = 'scholar-1';
        return emilOpeningAttack;
      }) as any)
      .mockResolvedValue({
        results: [],
        currentParticipant: { id: 'scholar-1', name: 'The Scholar', participantType: 'player' },
        combatEnded: false,
        iterationCount: 0,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: DM_TEXT,
      roll_requests: [],
    } as any);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        intentBodies.push(body);
        const result =
          body.intent?.type === 'spell'
            ? chillTouchResult
            : { currentParticipant: { id: 'emil-1', name: 'Professor Emil Darkwater' } };
        return new Response(JSON.stringify({ result }), { status: 200 });
      }),
    );
  });

  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  const play = (
    onEngineNotice?: (notice: LocalNotice) => void,
  ): ReturnType<ReturnType<typeof useAIResponse>['getAIResponse']> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [{ text: PLAYER_INPUT, sender: 'player', timestamp: new Date().toISOString() }] as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      onEngineNotice,
    );
  };

  it('prints Emil’s opening swing, with the HP it left, before the player is asked for the spell die', async () => {
    const shown: LocalNotice[] = [];
    await play((notice) => {
      order.push(`line: ${notice.text}`);
      shown.push(notice);
    });

    // Initiative is asked, the seating line and Emil's swing are on screen, and only then does
    // the spell-attack prompt open. Before this, HP dropped with nothing said until the whole
    // resolution finished.
    expect(order).toEqual([
      'prompt: initiative',
      `line: ${SEATING_LINE}`,
      `line: ${EMIL_LINE}`,
      'prompt: attack Chill Touch',
    ]);
    // The seating transcript was persisted by the server; Emil's line was not, so the client
    // saves it.
    expect(shown).toEqual([
      { text: SEATING_LINE, persist: false },
      {
        text: EMIL_LINE,
        persist: true,
        cards: [expect.objectContaining({ kind: 'attack', line: EMIL_LINE })],
      },
    ]);
  });

  it('returns exactly one engine line for the spell, before the DM text, and no DM roll popup', async () => {
    const response = await play(() => {});

    // The die the player threw reached the engine, as the natural face.
    expect(intentBodies.find((body) => body.intent?.type === 'spell')?.intent.d20).toBe(7);

    // One line for the cast: spell, d20 + bonus = total vs AC, hit or miss. It leads the reply.
    expect(response.text.startsWith(CHILL_TOUCH_LINE)).toBe(true);
    expect(response.text.match(/cast Chill Touch/g)).toHaveLength(1);
    expect(response.text.indexOf(CHILL_TOUCH_LINE)).toBeLessThan(
      response.text.indexOf('Cold clings to the professor'),
    );
    expect(response.context?.combatEngineBlocks).toEqual([
      expect.objectContaining({ source: 'player', lines: [CHILL_TOUCH_LINE] }),
    ]);
    // Emil's line was shown when it happened; it is not printed a second time here.
    expect(response.text).not.toContain(EMIL_LINE);
    expect(response.localNotices).toBeUndefined();

    // The DM asked for an attack and a "Critical damage roll"; in combat neither becomes a
    // popup, which is what withheld the engine line behind it in run 15.
    expect(response.rollRequests).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'enc-1',
      type: 'attack',
      purpose: 'Chill Touch spell attack',
    });
    expect(logger.warn).toHaveBeenCalledWith('DM_ROLL_REQUEST_DROPPED', {
      encounterId: 'enc-1',
      type: 'damage',
      purpose: 'Critical damage roll',
    });
  });

  it('a caller that cannot show lines early still gets Emil’s line, once, ahead of the spell line', async () => {
    const response = await play();

    expect(response.text.indexOf(EMIL_LINE)).toBeGreaterThanOrEqual(0);
    expect(response.text.match(/rolled 14 \+ 3 = 17/g)).toHaveLength(1);
    expect(response.text.indexOf(EMIL_LINE)).toBeLessThan(response.text.indexOf(CHILL_TOUCH_LINE));
    expect(response.text.indexOf(CHILL_TOUCH_LINE)).toBeLessThan(
      response.text.indexOf('Cold clings to the professor'),
    );
    expect(response.localNotices).toEqual([{ text: SEATING_LINE, persist: false }]);
    expect(response.rollRequests).toEqual([]);
  });
});
