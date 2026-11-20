/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #614 — a rest request during an active fight is refused before the DM is called. The refusal
 * is an engine notice (persisted), the turn settles, and the composer stays the player's. A rest
 * outside a fight, and a line that only mentions resting, still reach the DM.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import { useCharacter } from '@/contexts/CharacterContext';
import { useCombat } from '@/contexts/CombatContext';
import { REST_IN_COMBAT_NOTICE } from '@/hooks/ai/combat-notice';
import { handleDmActionsAndTransitions } from '@/hooks/ai/dm-actions-handler';
import { AIService } from '@/services/ai-service';
import { consumeCombatEntryTypedAnswer } from '@/services/combat/combat-entry-confirmation-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(() => ({ state: { character: null } })),
}));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    detectDeclaredAttack: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
  requestCombatEntryAnswer: vi.fn(),
  consumeCombatEntryTypedAnswer: vi.fn().mockReturnValue(false),
}));
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

const liveEncounter = {
  id: 'enc-1',
  phase: 'active',
  currentTurnParticipantId: 'turn-entity',
  currentRound: 1,
  participants: [],
};

const playerLine = (text: string) => [
  { text, sender: 'player', timestamp: new Date().toISOString() },
];

describe('useAIResponse: a rest request during a fight (#614)', () => {
  const play = async (text: string, inFight: boolean) => {
    vi.mocked(useCombat).mockReturnValue(
      inFight
        ? ({
            state: { isInCombat: true, activeEncounter: liveEncounter },
            refreshCombatState: vi.fn(async () => liveEncounter),
          } as any)
        : ({
            state: { isInCombat: false, activeEncounter: null },
            refreshCombatState: vi.fn(async () => null),
          } as any),
    );
    const { result } = renderHook(() => useAIResponse());
    const response = await result.current.getAIResponse(
      playerLine(text) as any,
      DECLARED_ATTACK_SESSION_ID,
    );
    return { response, result };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(consumeCombatEntryTypedAnswer).mockReturnValue(false);
    vi.mocked(useCharacter).mockReturnValue({ state: { character: null } } as any);
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
      json: async () => ({ pending: null }),
    } as any);
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'The Veteran waits for you to act.',
      roll_requests: [],
    } as any);
    vi.mocked(handleDmActionsAndTransitions).mockImplementation((async (params: any) => ({
      result: params.result,
      responseText: params.result.text,
      narrationSegments: undefined,
      isInCombat: true,
      activeEncounter: liveEncounter,
    })) as any);
  });

  it('refuses in words before the DM is called, persists the notice, and settles the turn', async () => {
    const { response, result } = await play('I want to take a long rest right here.', true);

    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();
    expect(response.localNotice).toBe(REST_IN_COMBAT_NOTICE);
    expect(response.localNotices).toEqual([{ text: REST_IN_COMBAT_NOTICE, persist: true }]);
    expect(response.text).toBe('');
    expect(result.current.combatTurnUiState.preflight).not.toBe('running');
  });

  it('a short rest typed in a fight is refused the same way', async () => {
    const { response } = await play('I short rest.', true);

    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(response.localNotices).toEqual([{ text: REST_IN_COMBAT_NOTICE, persist: true }]);
  });

  it('"I rest my hand on the wall" in a fight still goes to the DM', async () => {
    const { response } = await play('I rest my hand on the wall.', true);

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AIService.chatWithDM).mock.calls[0][0].message).toBe(
      'I rest my hand on the wall.',
    );
    expect(response.localNotice).toBeUndefined();
  });

  it('outside a fight, a rest request still goes to the DM', async () => {
    await play('I take a long rest in the inn.', false);

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AIService.chatWithDM).mock.calls[0][0].message).toBe(
      'I take a long rest in the inn.',
    );
  });
});
