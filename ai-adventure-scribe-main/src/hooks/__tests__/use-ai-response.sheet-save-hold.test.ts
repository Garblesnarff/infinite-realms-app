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
import { processRollRequests } from '@/hooks/ai/roll-processor';
import { AIService } from '@/services/ai-service';
import {
  beginSheetCast,
  cancelSheetCast,
  finishSheetCast,
  resetSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';
import { setSpellTargetSaveHost } from '@/services/combat/spell-target-save-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CharacterContext', () => ({
  // #400: the owned sheet for the suggestion filter; null keeps the filter a no-op here.
  useCharacter: () => ({ state: { character: null } }),
}));
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
  },
}));
vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
// The engine's read-only answer to "what would this spell be?": `proposeSpellAttack`'s output.
vi.mock('@/services/combat/combat-attack-proposal', () => ({
  proposeAuthoritativeSpell: vi.fn().mockResolvedValue({
    movementOnly: false,
    spellId: 'acid-splash',
    spellName: 'Acid Splash',
    kind: 'save',
    attackBonus: 6,
    saveDC: 14,
    targetAc: 12,
    advantage: false,
    disadvantage: false,
  }),
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
  const play = (message: unknown, dmMessageId?: string) => {
    const { result } = renderHook(() => useAIResponse());
    return result.current.getAIResponse(
      [message] as any,
      SESSION_ID,
      undefined,
      undefined,
      undefined,
      dmMessageId,
    );
  };
  const cardIsOpen = () => vi.waitFor(() => expect(presented).toHaveLength(1));

  beforeEach(() => {
    vi.clearAllMocks();
    resetSheetCastProgress();
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
      saveDc: 14,
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

  describe('Cancel cast (#2418)', () => {
    const CANCELLED = 'Cast cancelled. No spell slot was used.';

    it('on the card: the DM is never called, nothing reaches the engine, and one notice says so', async () => {
      inFight(sarah);
      beginSheetCast('Acid Splash');

      const turn = play(sheetCast('acid-splash', 'Acid Splash'));
      await cardIsOpen();
      cancelSheetCast();
      const reply = await turn;

      expect(reply).toMatchObject({
        text: '',
        sender: 'dm',
        localNotice: CANCELLED,
        localNotices: [{ text: CANCELLED, persist: true }],
      });
      expect(AIService.chatWithDM).not.toHaveBeenCalled();
      expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();
    });

    it('while the DM reads: the request carries the cast’s signal, and aborting it ends the turn with the notice', async () => {
      inFight(sarah, imp);
      beginSheetCast('Acid Splash');
      vi.mocked(AIService.chatWithDM).mockImplementation(
        ((params: any) =>
          new Promise((_resolve, reject) => {
            params.signal.addEventListener('abort', () =>
              reject(new Error('Failed to get DM response - AI service unavailable')),
            );
          })) as any,
      );

      const turn = play(sheetCast('acid-splash', 'Acid Splash'));
      await vi.waitFor(() => expect(AIService.chatWithDM).toHaveBeenCalledTimes(1));
      expect((vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any).signal).toBeInstanceOf(
        AbortSignal,
      );
      cancelSheetCast();
      const reply = await turn;

      expect(reply).toMatchObject({ text: '', localNotice: CANCELLED });
      expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();
      finishSheetCast();
    });

    it('cancelled before the DM call (queued behind another turn): the DM is never called', async () => {
      inFight(sarah, imp);
      beginSheetCast('Acid Splash');
      cancelSheetCast();

      const reply = await play(sheetCast('acid-splash', 'Acid Splash'));

      expect(reply).toMatchObject({ text: '', localNotice: CANCELLED });
      expect(AIService.chatWithDM).not.toHaveBeenCalled();
      finishSheetCast();
    });

    it('a reply that arrives after the cancel is dropped, not shown', async () => {
      inFight(sarah, imp);
      beginSheetCast('Acid Splash');
      vi.mocked(AIService.chatWithDM).mockImplementation((async () => {
        cancelSheetCast();
        return { text: 'The acid hisses.', roll_requests: [] };
      }) as any);

      const reply = await play(sheetCast('acid-splash', 'Acid Splash'));

      expect(reply).toMatchObject({ text: '', localNotice: CANCELLED });
      expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();
      finishSheetCast();
    });

    it('asks the server not to keep prose for a cast that can still be cancelled', async () => {
      inFight(sarah, imp);
      beginSheetCast('Acid Splash');
      await play(sheetCast('acid-splash', 'Acid Splash'), '11111111-2222-4333-8444-555555555501');
      finishSheetCast();

      const call = vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any;
      // In combat the hold rides alongside combat state, not instead of it.
      expect(call.dmReply).toMatchObject({ inCombat: true, holdProse: true });
    });

    it('a DM failure that is not a cancel still fails the turn', async () => {
      inFight(sarah, imp);
      beginSheetCast('Acid Splash');
      vi.mocked(AIService.chatWithDM).mockRejectedValue(new Error('AI service unavailable'));

      await expect(play(sheetCast('acid-splash', 'Acid Splash'))).rejects.toThrow(
        'AI service unavailable',
      );
      finishSheetCast();
    });

    it('a typed cast carries no signal: there is no cast on the sheet to cancel', async () => {
      inFight(sarah);
      await play({ ...sheetCast('acid-splash', 'Acid Splash'), context: { intent: 'query' } });

      expect((vi.mocked(AIService.chatWithDM).mock.calls[0][0] as any).signal).toBeUndefined();
    });
  });

  describe('Sheet casts outside combat (#1021)', () => {
    const CANCELLED = 'Cast cancelled. No spell slot was used.';

    // The inFight tests above leave the useCombat mock reporting combat (clearAllMocks does
    // not undo mockReturnValue), so pin the out-of-combat state here instead of trusting default.
    beforeEach(() => {
      vi.mocked(useCombat).mockReturnValue({
        state: { isInCombat: false, activeEncounter: null },
        refreshCombatState: vi.fn(async () => null),
      } as any);
    });

    it('holds cancelled exploration-cast prose independently of combat state for a reload', async () => {
      // No encounter: the block's inner beforeEach pins useCombat out of combat.
      beginSheetCast('Acid Splash');
      vi.mocked(AIService.chatWithDM).mockImplementation((async () => {
        cancelSheetCast();
        return { text: 'The acid hisses.', roll_requests: [] };
      }) as any);
      try {
        const reply = await play(
          sheetCast('acid-splash', 'Acid Splash'),
          '00000000-0000-4000-8000-000000001021',
        );
        expect(reply).toMatchObject({ text: '', localNotice: CANCELLED });
        expect(handleDmActionsAndTransitions).not.toHaveBeenCalled();
        const call = vi.mocked(AIService.chatWithDM).mock.calls[0]?.[0] as any;
        expect(call.dmReply).toMatchObject({ inCombat: false, holdProse: true });
      } finally {
        finishSheetCast();
      }
    });

    it('keeps an exploration sheet cast on the story slot and roll path', async () => {
      // The cancellation signal belongs to the Cast button, not to combat. Outside combat the
      // server must therefore receive an ordinary narrative turn so story-spell-slots can spend a
      // levelled slot and a cantrip's attack roll can reach the dice queue.
      beginSheetCast('Acid Splash');
      await play(sheetCast('acid-splash', 'Acid Splash'), '11111111-2222-4333-8444-555555555502');
      const call = vi.mocked(AIService.chatWithDM).mock.calls[0]?.[0] as any;
      expect(call.dmReply).toMatchObject({ inCombat: false, holdProse: true });
      finishSheetCast();
    });

    it('an attack cantrip with a target rolls: its attack request reaches the dice queue (G22-013)', async () => {
      beginSheetCast('Fire Bolt');
      vi.mocked(AIService.chatWithDM).mockImplementation((async () => ({
        text: 'The bolt streaks toward the goblin.',
        roll_requests: [{ type: 'attack', formula: '1d20+5', purpose: 'Fire Bolt attack' }],
      })) as any);
      vi.mocked(handleDmActionsAndTransitions).mockImplementation((async (params: any) => ({
        result: params.result,
        responseText: params.result.text,
        narrationSegments: undefined,
        isInCombat: false,
        activeEncounter: null,
      })) as any);
      await play(sheetCast('fire-bolt', 'Fire Bolt'), '11111111-2222-4333-8444-555555555503');
      const call = vi.mocked(AIService.chatWithDM).mock.calls[0]?.[0] as any;
      expect(call.dmReply).toMatchObject({ inCombat: false, holdProse: true });
      expect(vi.mocked(processRollRequests)).toHaveBeenCalledWith(
        expect.objectContaining({
          existingRequests: [
            expect.objectContaining({ type: 'attack', formula: '1d20+5' }),
          ],
        }),
      );
      finishSheetCast();
    });
  });
});
