/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2341 — a message that names an attack, with no encounter open, asks the player BEFORE the DM
 * is called. Run 14's "I cast Chill Touch at Valerius" was narrated as a miss, and Valerius
 * moved, and only then did the popup mount. Both answers are covered: the DM request is not
 * sent while the popup is open, and what it is sent after depends on the answer.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
  declaredAttackCheckBody,
  pickedTargetCheckBody,
  SHEET_CAST_PLAYER_INPUT,
  sheetCastCheckBody,
  untargetedSpellCheckBody,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import { useCombat } from '@/contexts/CombatContext';
import {
  buildSpellCastContext,
  buildSpellCastMessage,
} from '@/features/game-session/components/game/overhaul/spell-view-model';
import { handleDmActionsAndTransitions } from '@/hooks/ai/dm-actions-handler';
import { AIService } from '@/services/ai-service';
import {
  requestCombatEntryAnswer,
  requestCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';
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

const pending = {
  trigger: 'player_intent' as const,
  detail: 'player declared an attack on Valerius',
  combatants: [{ name: 'Valerius', count: 1 }],
  sceneSpec: { sessionId: DECLARED_ATTACK_SESSION_ID },
  sceneSpecSynthesized: true,
  declaredAttack: {
    verb: 'cast Chill Touch',
    actorName: 'Valerius',
    attackSource: 'spell' as const,
    spellId: 'chill-touch',
    spellName: 'Chill Touch',
  },
};

const chillTouchMessages = [
  {
    text: declaredAttackCheckBody.playerInput,
    sender: 'player',
    timestamp: new Date().toISOString(),
  },
];

describe('useAIResponse: the combat-entry popup comes before the DM (#2341)', () => {
  let order: string[];
  let choose: (confirmed: boolean) => void;

  const play = async (messages: unknown[] = chillTouchMessages) => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(messages as any, DECLARED_ATTACK_SESSION_ID);
  };
  const popupIsOpen = () =>
    vi.waitFor(() => expect(requestCombatEntryConfirmation).toHaveBeenCalledTimes(1));

  beforeEach(() => {
    vi.clearAllMocks();
    order = [];
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: DECLARED_ATTACK_SESSION_ID,
      campaign_id: 'camp-1',
      character_id: declaredAttackCharacter.id,
      campaign: { id: 'camp-1' },
      character: declaredAttackCharacter,
    } as any);
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pending }),
    } as any);
    vi.mocked(requestCombatEntryConfirmation).mockImplementation(() => {
      order.push('popup opened');
      return new Promise<boolean>((resolve) => {
        choose = (confirmed) => {
          order.push(`popup answered: ${confirmed ? 'strike' : 'something else'}`);
          resolve(confirmed);
        };
      });
    });
    vi.mocked(AIService.chatWithDM).mockImplementation((async () => {
      order.push('DM called');
      return { text: 'You let the spell fade.', roll_requests: [] };
    }) as any);
    vi.mocked(handleDmActionsAndTransitions).mockImplementation((async (params: any) => {
      order.push('handler');
      return {
        result: params.result,
        responseText: params.result.text,
        narrationSegments: undefined,
        isInCombat: false,
        activeEncounter: null,
      };
    }) as any);
  });

  it('Strike: the DM is not called while the popup is open, and not called for a first answer at all', async () => {
    const turn = play();
    await popupIsOpen();
    await Promise.resolve();

    // The player has not answered: no DM request has left the client.
    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();
    expect(userDataApi.detectDeclaredAttack).toHaveBeenCalledWith(
      DECLARED_ATTACK_SESSION_ID,
      declaredAttackCheckBody,
    );

    choose(true);
    await turn;

    // The engine takes the turn from here (roll, then the DM narrates the engine lines from
    // inside the handler). There is no DM answer for the declaration to have narrated a miss.
    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(order).toEqual(['popup opened', 'popup answered: strike', 'handler']);
    expect(handleDmActionsAndTransitions).toHaveBeenCalledWith(
      expect.objectContaining({
        entryConfirmed: true,
        result: expect.objectContaining({ text: '', combat_entry_pending: pending }),
      }),
    );
  });

  it('Do something else: the DM is called only after the answer, told nothing happened', async () => {
    const turn = play();
    await popupIsOpen();
    await Promise.resolve();
    expect(AIService.chatWithDM).not.toHaveBeenCalled();

    choose(false);
    const response = await turn;

    expect(order).toEqual([
      'popup opened',
      'popup answered: something else',
      'DM called',
      'handler',
    ]);
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    const dmRequest = vi.mocked(AIService.chatWithDM).mock.calls[0][0];
    expect(dmRequest.message).toBe(declaredAttackCheckBody.playerInput);
    expect(dmRequest.context.gameState?.combatEntryDeclined).toBe(
      'the spell Chill Touch against Valerius',
    );
    // The turn then runs as an ordinary narrative turn, not as an entry.
    expect(handleDmActionsAndTransitions).toHaveBeenCalledWith(
      expect.not.objectContaining({ entryConfirmed: true }),
    );
    expect(response.text).toContain('You let the spell fade.');
  });

  it('Do something else: whatever the model asks for, no roll is prompted and nothing is started', async () => {
    vi.mocked(AIService.chatWithDM).mockImplementation((async (params: any) => {
      const modelReply = {
        text: 'You let the spell fade.',
        combat_transition: 'start',
        combat_actions: [{ action_type: 'attack' }],
        map_actions: [{ action: 'move' }],
        roll_requests: [{ type: 'attack', formula: '1d20+6', purpose: 'Chill Touch' }],
        combatDetection: { isCombat: true, shouldStartCombat: true },
      };
      await params.onTextReady?.(modelReply);
      return modelReply;
    }) as any);
    const onTextReady = vi.fn();
    const { result } = renderHook(() => useAIResponse());

    const turn = result.current.getAIResponse(
      chillTouchMessages as any,
      DECLARED_ATTACK_SESSION_ID,
      undefined,
      undefined,
      onTextReady,
    );
    await popupIsOpen();
    choose(false);
    await turn;

    // The early render shows the prose and prompts for nothing.
    expect(onTextReady).toHaveBeenCalledWith(
      expect.objectContaining({ rollRequests: [] }),
      expect.objectContaining({ suppressRender: false, earlyRollPromptAllowed: false }),
    );
    // And the handler never sees the model's combat output.
    expect(handleDmActionsAndTransitions).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          combat_transition: 'none',
          combat_actions: [],
          map_actions: [],
          roll_requests: [],
          combatDetection: expect.objectContaining({ shouldStartCombat: false }),
        }),
      }),
    );
  });

  it('sends the last DM message with the check, so "him" can be told from the narration', async () => {
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pending: null }),
    } as any);

    await play([
      { text: 'Valerius hangs from the ceiling.', sender: 'dm', timestamp: 't0' },
      chillTouchMessages[0],
    ]);

    expect(userDataApi.detectDeclaredAttack).toHaveBeenCalledWith(DECLARED_ATTACK_SESSION_ID, {
      ...declaredAttackCheckBody,
      recentNarration: 'Valerius hangs from the ceiling.',
    });
  });

  it('an attack spell aimed at "him": the DM is not called until the player has picked who', async () => {
    vi.mocked(userDataApi.detectDeclaredAttack)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          pending: null,
          targetChoice: { spellName: 'Fire Bolt', candidates: ['Valerius', 'Professor Darkwater'] },
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pending }),
      } as any);
    let pick: (answer: { confirmed: boolean; target?: string }) => void = () => {};
    vi.mocked(requestCombatEntryAnswer).mockImplementation(
      () =>
        new Promise((resolve) => {
          order.push('picker opened');
          pick = (answer) => {
            order.push('picked');
            resolve(answer);
          };
        }),
    );

    const turn = play([
      { text: untargetedSpellCheckBody.recentNarration, sender: 'dm', timestamp: 't0' },
      { ...chillTouchMessages[0], text: untargetedSpellCheckBody.playerInput },
    ]);
    await vi.waitFor(() => expect(requestCombatEntryAnswer).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(AIService.chatWithDM).not.toHaveBeenCalled();

    pick({ confirmed: true, target: 'Valerius' });
    await turn;

    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(vi.mocked(userDataApi.detectDeclaredAttack).mock.calls.map(([, body]) => body)).toEqual([
      untargetedSpellCheckBody,
      pickedTargetCheckBody,
    ]);
    expect(order).toEqual(['picker opened', 'picked', 'handler']);
    expect(handleDmActionsAndTransitions).toHaveBeenCalledWith(
      expect.objectContaining({ entryConfirmed: true }),
    );
  });

  it("the sheet's Cast of Chill Touch names no creature: the picker opens before the DM, from the exact line the sheet sends (#2415)", async () => {
    // The producer is the sheet's own: the fixture is not a hand-typed copy of its output.
    const spell = { name: 'Chill Touch', id: 'chill-touch', level: 0 };
    expect(buildSpellCastMessage(spell)).toBe(SHEET_CAST_PLAYER_INPUT);
    vi.mocked(userDataApi.detectDeclaredAttack)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          pending: null,
          targetChoice: { spellName: 'Chill Touch', candidates: ['Captain Sarah Reeves'] },
        }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ pending }),
      } as any);
    let pick: (answer: { confirmed: boolean; target?: string }) => void = () => {};
    vi.mocked(requestCombatEntryAnswer).mockImplementation(
      () =>
        new Promise((resolve) => {
          pick = resolve;
        }),
    );

    const turn = play([
      { text: sheetCastCheckBody.recentNarration, sender: 'dm', timestamp: 't0' },
      {
        text: buildSpellCastMessage(spell),
        sender: 'player',
        timestamp: 't1',
        context: buildSpellCastContext({ id: spell.id, level: spell.level }),
      },
    ]);
    await vi.waitFor(() => expect(requestCombatEntryAnswer).toHaveBeenCalledTimes(1));
    expect(requestCombatEntryAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        targetChoices: ['Captain Sarah Reeves'],
        spellLabel: 'Chill Touch',
      }),
    );
    expect(AIService.chatWithDM).not.toHaveBeenCalled();

    pick({ confirmed: true, target: 'Captain Sarah Reeves' });
    await turn;

    expect(AIService.chatWithDM).not.toHaveBeenCalled();
    expect(vi.mocked(userDataApi.detectDeclaredAttack).mock.calls.map(([, body]) => body)).toEqual([
      sheetCastCheckBody,
      { ...sheetCastCheckBody, targetName: 'Captain Sarah Reeves' },
    ]);
  });

  it('asks the DM as usual when the message names no attack', async () => {
    vi.mocked(userDataApi.detectDeclaredAttack).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ pending: null }),
    } as any);

    await play([{ ...chillTouchMessages[0], text: 'I study the fold.' }]);

    expect(requestCombatEntryConfirmation).not.toHaveBeenCalled();
    expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
    expect(vi.mocked(AIService.chatWithDM).mock.calls[0][0].context.gameState).not.toHaveProperty(
      'combatEntryDeclined',
    );
  });

  it('does not check a message during a fight or a submitted dice result', async () => {
    const liveEncounter = {
      id: 'enc-1',
      phase: 'active',
      currentTurnParticipantId: 'turn-entity',
      currentRound: 1,
      participants: [],
    };
    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: true, activeEncounter: liveEncounter },
      refreshCombatState: vi.fn(async () => liveEncounter),
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);

    await play();
    expect(userDataApi.detectDeclaredAttack).not.toHaveBeenCalled();

    vi.mocked(useCombat).mockReturnValue({
      state: { isInCombat: false, activeEncounter: null },
      refreshCombatState: vi.fn(async () => null),
    } as any);
    await play([{ ...chillTouchMessages[0], context: { intent: 'dice_roll' } }]);
    expect(userDataApi.detectDeclaredAttack).not.toHaveBeenCalled();
    expect(requestCombatEntryConfirmation).not.toHaveBeenCalled();
  });
});
