/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAIResponse } from '../use-ai-response';

import { NEUTRAL_NO_EFFECT_LINE } from '@/hooks/ai/narration-gate';
import { AIService } from '@/services/ai-service';
import { requestCombatEntryConfirmation } from '@/services/combat/combat-entry-confirmation-bridge';
import { userDataApi } from '@/services/user-data-api';
import { createPlayerMessageFromOption, parseMessageOptions } from '@/utils/parseMessageOptions';

/**
 * #1041 (Hark G22-008) made a turn answering a listed option exempt from the whole
 * narration gate. #1048 narrows that: the exemption now covers only the gate's
 * no-effect replacement. The harm and outcome checks run on a click turn exactly as
 * on a typed turn — a DM line narrating a wound the engine never dealt is a
 * fabrication whichever way the player answered. The fixtures are the real click:
 * the DM message in the shape the renderer parses, the player message
 * `createPlayerMessageFromOption` produces from it.
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
    detectDeclaredAttack: vi.fn(),
  },
}));

vi.mock('@/services/combat/combat-entry-confirmation-bridge', () => ({
  requestCombatEntryConfirmation: vi.fn(),
  requestCombatEntryAnswer: vi.fn(),
  consumeCombatEntryTypedAnswer: vi.fn().mockReturnValue(false),
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
const CLEAN_REPLY =
  'The entity withdraws into the flooded dark, and the water goes still around the ferry.';
const NEUTRAL_CLICK_REPLY =
  'You shout your greeting across the water, and from the shrine a single bell answers.';
const REPEAT_HARM_REPLY = 'The blow leaves you wounded. The ferry rocks gently against the mud.';
const NEXT_OPTIONS = [
  'A. **Enter the nave**, wade into the flooded dark.',
  'B. **Take the bell**, ring it once and wait.',
];

const dmReply = (text: string): any => ({
  text,
  options: NEXT_OPTIONS,
  narrationSegments: [],
  dice_rolls: [],
  roll_requests: [],
  combatDetection: { isCombat: false },
});

describe('a listed-option turn: only the no-effect replacement is skipped (#1048)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: 'session-1048',
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    } as any);
    // No declared attack: the combat-entry hold stays out of these turns unless a
    // test arms it (the declined-entry case below).
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pending: null }),
    } as any);
    vi.mocked(requestCombatEntryConfirmation).mockResolvedValue(true);
  });

  const runTurn = async (messages: any[]): Promise<any> => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(messages, 'session-1048');
  };

  const clickTurn = (dmText: string, optionIndex = 0): any[] => {
    const clicked = parseMessageOptions(dmText).options[optionIndex];
    return [
      { text: dmText, sender: 'dm' },
      {
        text: createPlayerMessageFromOption(clicked),
        sender: 'player',
        context: { intent: 'query' },
      },
    ];
  };

  it('still gates a harm claim on a clicked option: rejected, regenerated, clean reply ships', async () => {
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(dmReply(HARM_REPLY))
      .mockResolvedValue(dmReply(CLEAN_REPLY));

    const response = await runTurn(clickTurn(DM_OFFERING_OPTIONS));

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    const regenRequest = vi.mocked(AIService.chatWithDM).mock.calls[1][0] as any;
    expect(regenRequest.narrationViolation).toContain(
      'Your previous reply for this turn was rejected',
    );
    expect(response.text).toContain('withdraws into the flooded dark');
    expect(response.text).not.toContain('leaves you wounded');
    expect(response.text).not.toContain('Nothing comes of that');
    expect((response as any).context?.actionOptions).toEqual(NEXT_OPTIONS);
  });

  it('does not replace a neutral answer on a clicked option, and the turn was checked', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmReply(NEUTRAL_CLICK_REPLY));

    const response = await runTurn(clickTurn(DM_OFFERING_OPTIONS, 1));

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    expect(response.text).toContain('a single bell answers');
    expect(response.text).not.toContain('Nothing comes of that');
    expect((response as any).context?.actionOptions).toEqual(NEXT_OPTIONS);
    // The checks were armed for this turn: the first DM call parked its side effects
    // for the gate to release, which is what tells the server to run its own harm
    // check on the persisted reply. An exempt turn sends neither.
    const firstRequest = vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any;
    expect(firstRequest).toMatchObject({ holdSideEffects: true });
  });

  it('on a clicked option whose reply violates twice, drops the claiming sentence and keeps the rest', async () => {
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(dmReply(HARM_REPLY))
      .mockResolvedValue(dmReply(REPEAT_HARM_REPLY));

    const response = await runTurn(clickTurn(DM_OFFERING_OPTIONS));

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    expect(response.text).toContain('rocks gently against the mud');
    expect(response.text).not.toContain('wounded');
    expect(response.text).not.toContain('Nothing comes of that');
    expect((response as any).context?.actionOptions).toEqual(NEXT_OPTIONS);
  });

  it('still replaces a harm claim on a free-text turn the engine did not resolve', async () => {
    vi.mocked(AIService.chatWithDM).mockResolvedValue(dmReply(HARM_REPLY));

    const response = await runTurn([
      { text: DM_OFFERING_OPTIONS, sender: 'dm' },
      { text: 'I swim out to the shrine bell.', sender: 'player', context: { intent: 'query' } },
    ]);

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    expect(response.text).toBe(NEUTRAL_NO_EFFECT_LINE);
    expect((response as any).context?.actionOptions).toBeUndefined();
  });

  it('gates a declined combat entry as a plain narrative turn, even though the turn began as a click (#1050 B1)', async () => {
    // The DM's listed option is the attack itself; clicking it opens the combat-entry
    // card, and the player answers "Do something else". The decline un-answers the
    // pick: the reply is checked as a plain narrative turn (#2341), in full.
    const DM_OFFERING_ATTACK = [
      'Valerius hangs from the ceiling of the flooded shrine, watching the ferry drift in.',
      '',
      'A. **Cast Chill Touch**, reach a ghostly hand toward Valerius.',
      'B. **Call out**, hail him by name.',
    ].join('\n');
    // The check response body in the shape the server sends (the declared-attack
    // fixture's pending entry, shared/test-fixtures/declared-attack-hold).
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        pending: {
          trigger: 'player_intent',
          detail: 'player declared an attack on Valerius',
          combatants: [{ name: 'Valerius', count: 1 }],
          sceneSpec: { sessionId: 'session-1048' },
          sceneSpecSynthesized: true,
          declaredAttack: {
            verb: 'cast Chill Touch',
            actorName: 'Valerius',
            attackSource: 'spell',
            spellId: 'chill-touch',
            spellName: 'Chill Touch',
          },
        },
      }),
    } as any);
    let answerCard: (confirmed: boolean) => void = () => {};
    vi.mocked(requestCombatEntryConfirmation).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          answerCard = resolve;
        }),
    );
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(dmReply(HARM_REPLY))
      .mockResolvedValue(dmReply(REPEAT_HARM_REPLY));

    const { result } = renderHook(() => useAIResponse());
    const turn = result.current.getAIResponse(clickTurn(DM_OFFERING_ATTACK) as any, 'session-1048');
    await vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1));
    answerCard(false);
    const response = await turn;

    const dmRequest = vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any;
    expect(dmRequest.context.gameState?.combatEntryDeclined).toBe(
      'the spell Chill Touch against Valerius',
    );
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    // The decline un-picks the turn, so the repeat violation ends at the no-effect
    // replacement like any plain narrative turn — not at the listed-option splice
    // the live-pick case above lands on. (If the pick survived the decline, this
    // turn would ship the spliced retry instead and this assertion would fail.)
    expect(response.text).toBe(NEUTRAL_NO_EFFECT_LINE);
    expect((response as any).context?.actionOptions).toBeUndefined();
  });

  it('does not honour an option from a DM reply a combat end superseded (#1050 B2)', async () => {
    // The pre-fight offer's options were withdrawn when the fight ended on the
    // engine's terminal row (#864); the player message still matches the withdrawn
    // option's text, but no live menu offered it for this turn.
    const PREFIGHT_OFFER = [
      'The shrine guard steps from the flooded trees, spear levelled at the ferry.',
      '',
      'A. **Attack the guard**, rush him before he can brace.',
      'B. **Back away**, hands raised and open.',
    ].join('\n');
    const clicked = parseMessageOptions(PREFIGHT_OFFER).options[0];
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(dmReply(HARM_REPLY))
      .mockResolvedValue(dmReply(REPEAT_HARM_REPLY));

    const response = await runTurn([
      { text: PREFIGHT_OFFER, sender: 'dm' },
      // The terminal engine row the server persists for a fight it ended itself:
      // an NPC engine message stamped combatEnded (buildNpcEngineMessage's shape,
      // shared/npc-engine-message.ts).
      {
        text: 'The guard falls beneath the water. Combat ended.',
        sender: 'system',
        context: { intent: 'combat_npc_result', combatEnded: true },
      },
      {
        text: createPlayerMessageFromOption(clicked),
        sender: 'player',
        context: { intent: 'query' },
      },
    ]);

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    // No live menu offered the option, so the turn is no pick: the repeat violation
    // ends at the no-effect replacement, not the listed-option splice. (If the
    // superseded offer still resolved as the source, this turn would ship the
    // spliced retry instead and this assertion would fail.)
    expect(response.text).toBe(NEUTRAL_NO_EFFECT_LINE);
    expect((response as any).context?.actionOptions).toBeUndefined();
  });

  it('picks the newest DM row a combat end did not supersede (#1050 B2)', async () => {
    // A pre-fight menu, then the fight's terminal row, then two live menus.
    // The click matches only the newest. An oldest-first find, or a find that
    // still reads the superseded offer, would miss the click and replace the
    // reply with the no-effect line.
    const PREFIGHT_OFFER = [
      'The shrine guard steps from the flooded trees, spear levelled at the ferry.',
      '',
      'A. **Attack the guard**, rush him before he can brace.',
      'B. **Back away**, hands raised and open.',
    ].join('\n');
    const OLDER_LIVE = [
      'The ferry sits quiet on the mud after the fight.',
      '',
      'A. **Look at the bell**, study the shrine bell from the rail.',
      'B. **Wait**, let the water settle.',
    ].join('\n');
    const NEWEST = [
      'A figure moves in the flooded nave.',
      '',
      'A. **Search the shrine**, wade in and look for the bell rope.',
      'B. **Stay on the ferry**, keep the rail between you and the dark.',
    ].join('\n');
    const clicked = parseMessageOptions(NEWEST).options[0];
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(dmReply(HARM_REPLY))
      .mockResolvedValue(dmReply(REPEAT_HARM_REPLY));

    const response = await runTurn([
      { text: PREFIGHT_OFFER, sender: 'dm' },
      {
        text: 'The guard falls beneath the water. Combat ended.',
        sender: 'system',
        context: { intent: 'combat_npc_result', combatEnded: true },
      },
      { text: OLDER_LIVE, sender: 'dm' },
      { text: NEWEST, sender: 'dm' },
      {
        text: createPlayerMessageFromOption(clicked),
        sender: 'player',
        context: { intent: 'query' },
      },
    ]);

    expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    expect(response.text).toContain('rocks gently against the mud');
    expect(response.text).not.toContain('wounded');
    expect(response.text).not.toContain('Nothing comes of that');
    expect((response as any).context?.actionOptions).toEqual(NEXT_OPTIONS);
  });
});
