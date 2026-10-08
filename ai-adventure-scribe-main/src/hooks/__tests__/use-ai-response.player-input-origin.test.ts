/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { userDataApi } from '@/services/user-data-api';

/**
 * #2305 round 2: `resolveDeclaredCombatActions` withholds every player action on a turn whose
 * `playerInputOrigin` is `null`, so a real player turn must never produce `null`. Its only caller
 * is this hook (through `handleDmActionsAndTransitions`), and the hook's only callers each append
 * the player's own message as the latest: `actualSendMessage` (typed text, option chips, the
 * sheet's Cast, dice results — live and after the #2286 reload recovery) and the `/roll` command.
 * This pins what each of those messages yields.
 */
const handledOrigins: unknown[] = [];
vi.mock('@/hooks/ai/dm-actions-handler', () => ({
  handleDmActionsAndTransitions: vi.fn(async (params: any) => {
    handledOrigins.push(params.playerInputOrigin);
    return {
      result: params.result,
      responseText: params.result.text,
      narrationSegments: [],
      deliveredHandouts: undefined,
      isInCombat: false,
      activeEncounter: null,
    };
  }),
}));

// Mock dependencies
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));

// Combat truth now arrives through refreshCombatState(), which re-reads the server. The
// default here is "no combat"; see browser-combat-pipeline.test.tsx for the same pipeline
// running against the real provider, reducer and sync hook rather than this stub.
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

// fetchGameContext() (see src/hooks/use-ai-response.ts) now fetches session/campaign/character
// data via userDataApi.getSessionContext() (a single Bun server REST call) instead of a
// supabase.from('game_sessions').select(...).single() join, so the mock target was updated
// to match. The real payload shape uses singular `campaign`/`character` keys (not the old
// `campaigns`/`characters` join aliases).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    endTacticalMap: vi.fn(),
    applyTacticalMapAction: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
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

// ensure-action-options repairs option-less DM turns via llmApiClient; keep it
// deterministic and offline in unit tests.
vi.mock('@/infrastructure/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    llmApiClient: {
      generateText: vi
        .fn()
        .mockResolvedValue(
          'A. **Look around**, survey your surroundings.\nB. **Press on**, continue toward your goal.\nC. **Call out**, announce your presence.',
        ),
    },
  };
});

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('the origin useAIResponse hands the combat resolution (#2305)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    handledOrigins.length = 0;
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'session-origin',
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    } as any);
    const { AIService } = await import('@/services/ai-service');
    (AIService.chatWithDM as any).mockResolvedValue({
      text: 'The spider rears.',
      narrationSegments: [],
      dice_rolls: [],
      roll_requests: [],
      combatDetection: { isCombat: false },
    });
  });

  const originFor = async (latest: Record<string, unknown>) => {
    const { result } = renderHook(() => useAIResponse());
    await result.current.getAIResponse(
      [{ text: 'Earlier.', sender: 'dm' }, latest] as any,
      'session-origin',
    );
    return handledOrigins.at(-1);
  };

  it.each([
    [
      'a typed turn (actualSendMessage builds intent query)',
      { text: 'I cast Chill Touch at it.', sender: 'player', context: { intent: 'query' } },
      'typed',
    ],
    [
      'a first message (intent first_action)',
      { text: 'I look around.', sender: 'player', context: { intent: 'first_action' } },
      'typed',
    ],
    [
      "the sheet's Cast",
      {
        text: 'I cast Chill Touch [spell_id=chill-touch, spell_level=cantrip].',
        sender: 'player',
        context: { intent: 'spell_cast', spellId: 'chill-touch', spellLevel: 0 },
      },
      'sheet_cast',
    ],
    [
      'a dice-roll reply (live, reload-recovered, or /roll)',
      {
        text: 'Insight check: 14',
        sender: 'player',
        context: { intent: 'dice_roll', diceRoll: { total: 14 } },
      },
      'dice_roll',
    ],
  ])('%s yields player input', async (_label, latest, expected) => {
    expect(await originFor(latest)).toBe(expected);
  });

  it('a system row yields null — and no caller ever passes one as the latest message', async () => {
    // #2298's roll_declined line is saved with onSendMessage, which persists and never generates.
    expect(
      await originFor({
        text: 'You chose not to roll: Insight.',
        sender: 'system',
        context: { intent: 'roll_declined' },
      }),
    ).toBeNull();
  });
});
