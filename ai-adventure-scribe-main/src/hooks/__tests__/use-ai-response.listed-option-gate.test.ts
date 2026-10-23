/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { NEUTRAL_NO_EFFECT_LINE } from '@/hooks/ai/narration-gate';
import { userDataApi } from '@/services/user-data-api';
import { createPlayerMessageFromOption, parseMessageOptions } from '@/utils/parseMessageOptions';

/**
 * #1041 (Hark G22-008): a turn answering a listed option the DM offered is not a
 * no-engine-event turn. The gate used to replace its reply with the no-effect line and
 * wipe the reply's options — a dead end. The fixture is the real click: the DM message
 * in the shape the renderer parses, the player message `createPlayerMessageFromOption`
 * produces from it. The DM's answer claims harm the engine never resolved, which is
 * exactly what the gate exists to catch on a free-text turn (the control case below).
 */
vi.mock('@/hooks/ai/dm-actions-handler', () => ({
  handleDmActionsAndTransitions: vi.fn(async (params: any) => ({
    result: params.result,
    responseText: params.result.text,
    narrationSegments: [],
    deliveredHandouts: undefined,
    isInCombat: false,
    activeEncounter: null,
  })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: {
      currentPhase: 'exploration',
      diceRollQueue: { pendingRolls: [] },
    },
    setGamePhase: vi.fn(),
  })),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
    lastRequestId: vi.fn(() => 'req-1'),
  },
}));

vi.mock('@/services/memory-manager', () => ({
  MemoryManager: {
    getRelevantMemories: vi.fn().mockResolvedValue([]),
  },
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

vi.mock('@/utils/combatDetection', () => ({
  detectCombatFromText: vi.fn(() => ({
    isCombat: false,
    confidence: 0,
    shouldStartCombat: false,
    shouldEndCombat: false,
    enemies: [],
    combatActions: [],
  })),
}));

vi.mock('@/infrastructure/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    llmApiClient: {
      generateText: vi.fn().mockResolvedValue(''),
    },
  };
});
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// The Gardener's Heir landing beat (G22-008): the DM offers the choice, the player clicks it.
const DM_OFFERING_OPTIONS = [
  'The ferry grounds itself on the mudflat below the drowned shrine, and the water goes still.',
  '',
  'A. **Sunken Temple**, descend into the flooded nave.',
  'B. **Call to Ombu**, shout your greeting across the water.',
].join('\n');
const HARM_REPLY =
  'You narrowly avoid a strike from the entity, though the blow leaves you wounded.';
const NEXT_OPTIONS = [
  'A. **Enter the nave**, wade into the flooded dark.',
  'B. **Take the bell**, ring it once and wait.',
];

describe('a turn answering a listed option is not gated (#1041)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'session-1041',
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    } as any);
    const { AIService } = await import('@/services/ai-service');
    (AIService.chatWithDM as any).mockResolvedValue({
      text: HARM_REPLY,
      options: NEXT_OPTIONS,
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
    });
  });

  const runTurn = async (playerText: string): Promise<any> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [
        { text: DM_OFFERING_OPTIONS, sender: 'dm' },
        { text: playerText, sender: 'player', context: { intent: 'query' } },
      ] as any,
      'session-1041',
    );
  };

  it('keeps the DM answer and its options when the player clicked a listed option', async () => {
    const { AIService } = await import('@/services/ai-service');
    const clicked = parseMessageOptions(DM_OFFERING_OPTIONS).options[0];
    const response = await runTurn(createPlayerMessageFromOption(clicked));

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    expect(response.text).toContain('narrowly avoid a strike');
    expect(response.text).not.toContain('Nothing comes of that');
    expect((response as any).context?.actionOptions).toEqual(NEXT_OPTIONS);
  });

  it('still replaces a harm claim on a free-text turn the engine did not resolve', async () => {
    const { AIService } = await import('@/services/ai-service');
    const response = await runTurn('I swim out to the shrine bell.');

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    expect(response.text).toBe(NEUTRAL_NO_EFFECT_LINE);
    expect((response as any).context?.actionOptions).toBeUndefined();
  });
});
