/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2392 — the sheet's Cast of a save spell (Acid Splash) shows its "Target saves" card BEFORE the
 * DM is called. Run 16 waited about 45 s on "Casting…" because the DM's whole reply came first and
 * the card only mounted when the reply's declared cast reached the engine. The bridge and the host
 * are real; the DM request is the stubbed edge, and it records when it leaves the client.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import type { SpellTargetSaveSpec } from '@/services/combat/spell-target-save-bridge';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { useCombat } from '@/contexts/CombatContext';
import { handleDmActionsAndTransitions } from '@/hooks/ai/dm-actions-handler';
import { AIService } from '@/services/ai-service';
import { setSpellTargetSaveHost } from '@/services/combat/spell-target-save-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'combat', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    detectDeclaredAttack: vi.fn(),
    advanceNpcTurns: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/hooks/ai/dm-actions-handler', () => ({ handleDmActionsAndTransitions: vi.fn() }));
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
vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn().mockResolvedValue({
    playerRollRequests: [],
    npcRollResults: [],
    npcRollContinuationText: '',
  }),
}));
vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/infrastructure/api', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  llmApiClient: { generateText: vi.fn().mockResolvedValue('') },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SESSION_ID = 'session-2392';
const CHARACTER = { id: 'char-1', name: 'The Apprentice' };

const participant = (
  id: string,
  name: string,
  participantType: 'player' | 'npc',
  characterId?: string,
) => ({
  id,
  ...(characterId ? { characterId } : {}),
  name,
  participantType,
  initiative: 10,
  initiativeModifier: 1,
  armorClass: 12,
  maxHp: 9,
  speed: 30,
  status: { currentHp: 9, maxHp: 9, tempHp: 0, isConscious: true },
});

const liveEncounter = (hostiles: ReturnType<typeof participant>[]) =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-2392',
      sessionId: SESSION_ID,
      status: 'active',
      currentRound: 1,
      currentTurnOrder: 0,
      startedAt: '2026-09-29T00:00:00.000Z',
    },
    participants: [participant('pc-id', 'The Apprentice', 'player', 'char-1'), ...hostiles],
  });

const sarah = participant('sarah-id', 'Captain Sarah Reeves', 'npc');
const imp = participant('imp-id', 'Kitchen Imp', 'npc');

const sheetCast = (spellId: string, name: string) => ({
  text: `I cast ${name} [spell_id=${spellId}, spell_level=cantrip].`,
  sender: 'player',
  timestamp: new Date().toISOString(),
  context: { intent: 'spell_cast', spellId, spellLevel: 0 },
});

describe('useAIResponse: the sheet save card comes before the DM (#2392)', () => {
  let order: string[];
  let presented: SpellTargetSaveSpec[];
  let continueCard: () => void;

  const inFight = (...hostiles: ReturnType<typeof participant>[]) => {
    const encounter = liveEncounter(hostiles);
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: encounter },
      refreshCombatState: vi.fn(async () => encounter),
    } as any);
  };
  const play = (message: unknown) => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse([message] as any, SESSION_ID);
  };
  const cardIsOpen = () => vi.waitFor(() => expect(presented).toHaveLength(1));

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    presented = [];
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: SESSION_ID,
      campaign_id: 'camp-1',
      character_id: CHARACTER.id,
      campaign: { id: 'camp-1' },
      character: CHARACTER,
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    setSpellTargetSaveHost({
      present: (spec, settle) => {
        order.push('card opened');
        presented.push(spec);
        continueCard = settle;
        return () => {};
      },
    });
    vi.mocked(AIService.chatWithDM).mockImplementation((async () => {
      order.push('DM called');
      return { text: 'The acid hisses.', roll_requests: [] };
    }) as any);
    vi.mocked(handleDmActionsAndTransitions).mockImplementation((async (params: any) => ({
      result: params.result,
      responseText: params.result.text,
      narrationSegments: undefined,
      isInCombat: true,
      activeEncounter: null,
    })) as any);
  });

  it('opens the card first: no DM request leaves the client until the player continues', async () => {
    inFight(sarah);

    const turn = play(sheetCast('acid-splash', 'Acid Splash'));
    await cardIsOpen();
    await Promise.resolve();

    expect(presented[0]).toMatchObject({
      targetLabel: 'Captain Sarah Reeves',
      spellName: 'Acid Splash',
    });
    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();

    continueCard();
    await turn;

    expect(order).toEqual(['card opened', 'DM called']);
  });

  it('calls the DM straight away for a typed cast, an attack spell, or a choice of creatures', async () => {
    inFight(sarah);
    await play({ ...sheetCast('acid-splash', 'Acid Splash'), context: { intent: 'query' } });
    await play(sheetCast('chill-touch', 'Chill Touch'));
    inFight(sarah, imp);
    await play(sheetCast('acid-splash', 'Acid Splash'));

    expect(presented).toEqual([]);
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(3);
  });
});
