import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NEUTRAL_NO_EFFECT_LINE,
  enforceNarrationGate,
  gateRollOutcomeContradiction,
  narrationViolationNote,
  narrativeTurnHasNoEngineEvent,
  releaseHeldSideEffects,
} from '../narration-gate';

import type { ChatMessage } from '@/services/ai-service';

import logger from '@/lib/logger';
import { SessionStateService } from '@/services/session-state-service';
import { createDefaultSessionState, type PersistedRollOutcome } from '@/types/session-state';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-1') },
  // Faithful copy of the real #2609 staleness bound (ai-service.ts); the bound itself is
  // covered by ai-service-roll-outcome-gate.test.ts, this mock only lets the wiring run.
  isRollOutcomeStale: (
    outcome: { timestamp: string },
    conversationHistory: Array<{ speakerType?: string; timestamp?: unknown }> = [],
  ): boolean => {
    let latestDmReplyMs = -1;
    for (const message of conversationHistory ?? []) {
      if (message.speakerType !== 'dm') continue;
      const ts = message.timestamp;
      const ms = ts instanceof Date ? ts.getTime() : NaN;
      if (!Number.isNaN(ms) && ms > latestDmReplyMs) latestDmReplyMs = ms;
    }
    if (latestDmReplyMs < 0) return false;
    const outcomeMs = Date.parse(outcome.timestamp);
    if (Number.isNaN(outcomeMs)) return true;
    return outcomeMs <= latestDmReplyMs;
  },
}));

const HARM = 'You narrowly avoid a strike from the entity, though the blow leaves you wounded.';
const CLEAN = 'The entity hums, unmoved by your words.';

const gate = (
  narration: Record<string, unknown>,
  regenerate = vi.fn(),
): ReturnType<typeof enforceNarrationGate> =>
  enforceNarrationGate({
    narration: narration as {
      text: string;
      narrationSegments?: unknown;
      heldSideEffects?: () => Promise<void>;
    },
    sessionId: 'session-1',
    branch: 'combat',
    regenerate,
  });

describe('enforceNarrationGate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes a reply with no harm claims and never asks again', async () => {
    const regenerate = vi.fn();
    const reply = { text: CLEAN };

    const outcome = await gate(reply, regenerate);

    expect(outcome).toEqual({ narration: reply, outcome: 'clean' });
    expect(regenerate).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects a harm claim, asks once with the claims named, and takes a clean retry', async () => {
    const retry = { text: CLEAN };
    const regenerate = vi.fn().mockResolvedValue(retry);

    const outcome = await gate({ text: HARM }, regenerate);

    expect(regenerate).toHaveBeenCalledTimes(1);
    const violation = regenerate.mock.calls[0][0] as string;
    expect(violation).toContain('strike from the entity');
    expect(violation).toContain('no roll, no attack, no damage, no condition');
    expect(outcome).toEqual({ narration: retry, outcome: 'regenerated' });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('DM_NARRATION_REJECTED', {
      reason: 'harm_claim_without_engine_event',
      sessionId: 'session-1',
      requestId: 'req-1',
      branch: 'combat',
      attempt: 1,
      claims: expect.arrayContaining(['strike from the entity']),
    });
  });

  it('replaces the narration with nothing of the rejected reply left on it', async () => {
    const regenerate = vi.fn().mockResolvedValue({ text: HARM });

    const outcome = await gate(
      {
        text: HARM,
        narrationSegments: [{ text: HARM }],
        options: ['A. Attack the guard'],
        handout_actions: [{ key: 'a' }],
        map_actions: [{ type: 'move' }],
        scene_spec: { environment: 'tavern' },
        dice_rolls: [],
      },
      regenerate,
    );

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(outcome.outcome).toBe('replaced');
    expect(outcome.narration).toEqual({
      text: NEUTRAL_NO_EFFECT_LINE,
      narrationSegments: undefined,
      options: undefined,
      handout_actions: [],
      map_actions: [],
      scene_spec: null,
      heldSideEffects: undefined,
      dice_rolls: [],
    });
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenLastCalledWith(
      'DM_NARRATION_REJECTED',
      expect.objectContaining({ attempt: 2, reason: 'harm_claim_without_engine_event' }),
    );
  });

  describe('held side effects (memory, world updates, voice)', () => {
    it('runs a clean reply’s once it passes', async () => {
      const held = vi.fn().mockResolvedValue(undefined);

      await gate({ text: CLEAN, heldSideEffects: held });

      expect(held).toHaveBeenCalledTimes(1);
    });

    it('runs only the surviving retry’s: the rejected reply writes nothing', async () => {
      const first = vi.fn().mockResolvedValue(undefined);
      const second = vi.fn().mockResolvedValue(undefined);

      const outcome = await gate(
        { text: HARM, heldSideEffects: first },
        vi.fn().mockResolvedValue({ text: CLEAN, heldSideEffects: second }),
      );

      expect(outcome.outcome).toBe('regenerated');
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('runs neither when both replies claim harm, and the neutral line carries none', async () => {
      const first = vi.fn().mockResolvedValue(undefined);
      const second = vi.fn().mockResolvedValue(undefined);

      const outcome = await gate(
        { text: HARM, heldSideEffects: first },
        vi.fn().mockResolvedValue({ text: HARM, heldSideEffects: second }),
      );

      expect(outcome.outcome).toBe('replaced');
      expect(first).not.toHaveBeenCalled();
      expect(second).not.toHaveBeenCalled();
      expect(outcome.narration).toHaveProperty('heldSideEffects', undefined);
    });

    it('runs nothing when the second ask throws', async () => {
      const first = vi.fn().mockResolvedValue(undefined);

      await gate({ text: HARM, heldSideEffects: first }, vi.fn().mockRejectedValue(new Error('x')));

      expect(first).not.toHaveBeenCalled();
    });

    it('releaseHeldSideEffects is a no-op for a reply that parked nothing', () => {
      expect(() => releaseHeldSideEffects({ text: CLEAN })).not.toThrow();
      expect(() => releaseHeldSideEffects(undefined)).not.toThrow();
    });
  });

  it('fails closed when the second ask throws', async () => {
    const regenerate = vi.fn().mockRejectedValue(new Error('upstream 503'));

    const outcome = await gate({ text: HARM }, regenerate);

    expect(outcome.outcome).toBe('replaced');
    expect(outcome.narration.text).toBe(NEUTRAL_NO_EFFECT_LINE);
    expect(logger.warn).toHaveBeenLastCalledWith(
      'DM_NARRATION_REJECTED',
      expect.objectContaining({ attempt: 2, reason: 'regeneration_failed' }),
    );
  });

  it('names every claim in the note the DM is given', () => {
    const note = narrationViolationNote(['avoid a strike', 'wounded']);
    expect(note).toContain('"avoid a strike", "wounded"');
    expect(note).toContain('no creature attacked');
  });

  describe('with an engine outcome (#266)', () => {
    const gateWithOutcome = (
      narration: Record<string, unknown>,
      engineOutcome: { success: boolean; characterName?: string },
      regenerate = vi.fn(),
    ): ReturnType<typeof enforceNarrationGate> =>
      enforceNarrationGate({
        narration: narration as { text: string },
        sessionId: 'session-1',
        branch: 'narrative',
        playerMayHaveActed: true,
        engineOutcome,
        regenerate,
      });

    it('rejects a failed check narrated as a success, names the verdict, and takes a clean retry', async () => {
      const retry = { text: 'Your foot scrapes stone. You fail to stay quiet.' };
      const regenerate = vi.fn().mockResolvedValue(retry);

      const outcome = await gateWithOutcome(
        { text: 'You move with practiced stillness. You succeed without a sound.' },
        { success: false },
        regenerate,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      const violation = regenerate.mock.calls[0][0] as string;
      expect(violation).toContain('FAILED');
      expect(violation).toContain('"you succeed"');
      expect(outcome).toEqual({ narration: retry, outcome: 'regenerated' });
      expect(logger.warn).toHaveBeenCalledWith(
        'DM_NARRATION_REJECTED',
        expect.objectContaining({ reason: 'outcome_contradicts_engine', attempt: 1 }),
      );
    });

    it('accepts an NPC success against a failed verdict', async () => {
      const regenerate = vi.fn();
      const reply = { text: 'The guard successfully spots you and raises the alarm.' };

      const outcome = await gateWithOutcome(reply, { success: false }, regenerate);

      expect(outcome).toEqual({ narration: reply, outcome: 'clean' });
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('rejects "you fail to notice, but succeed" against a failed verdict', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'You fail to stay quiet.' });

      const outcome = await gateWithOutcome(
        { text: 'You fail to notice the tripwire, but succeed in slipping past.' },
        { success: false },
        regenerate,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('regenerated');
    });

    it('rejects the success claim when the negation sits in an earlier clause', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'You fail to stay quiet.' });

      const outcome = await gateWithOutcome(
        { text: 'The guard does not notice you and you succeed without a sound.' },
        { success: false },
        regenerate,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('regenerated');
    });

    it('accepts a correct failure narration', async () => {
      const regenerate = vi.fn();
      const reply = { text: 'The clatter echoes. You fail to stay quiet.' };

      const outcome = await gateWithOutcome(reply, { success: false }, regenerate);

      expect(outcome).toEqual({ narration: reply, outcome: 'clean' });
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('accepts a success check narrated as a success', async () => {
      const regenerate = vi.fn();
      const reply = { text: 'You succeed, slipping past unheard.' };

      const outcome = await gateWithOutcome(reply, { success: true }, regenerate);

      expect(outcome).toEqual({ narration: reply, outcome: 'clean' });
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('rejects an engine hit narrated as a miss', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'Your blade bites deep.' });

      const outcome = await gateWithOutcome(
        { text: 'The strike goes wide and misses entirely.' },
        { success: true },
        regenerate,
      );

      expect(outcome.outcome).toBe('regenerated');
      expect(logger.warn).toHaveBeenCalledWith(
        'DM_NARRATION_REJECTED',
        expect.objectContaining({ reason: 'outcome_contradicts_engine' }),
      );
    });

    it('accepts "you miss the sunrise" against a successful verdict', async () => {
      const regenerate = vi.fn();
      const reply = { text: 'Dawn breaks. You miss the sunrise, still climbing.' };

      const outcome = await gateWithOutcome(reply, { success: true }, regenerate);

      expect(outcome).toEqual({ narration: reply, outcome: 'clean' });
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('does not run the harm check when the engine resolved the turn', async () => {
      const regenerate = vi.fn();
      // A hit dealing damage is legitimate here, not a fabricated harm claim.
      const reply = { text: 'Your blade bites deep. You deal 4 damage.' };

      const outcome = await gateWithOutcome(reply, { success: true }, regenerate);

      expect(outcome.outcome).toBe('clean');
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('replaces the reply when the retry still contradicts the verdict', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'You succeed without a sound.' });

      const outcome = await gateWithOutcome(
        { text: 'You succeed without a sound.' },
        { success: false },
        regenerate,
      );

      expect(outcome.outcome).toBe('replaced');
      expect(outcome.narration.text).toBe(NEUTRAL_NO_EFFECT_LINE);
    });

    it('flags past-tense success claims against a failed verdict', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'You fail to stay quiet.' });

      const outcome = await gateWithOutcome(
        { text: 'You succeeded in climbing the shaft unnoticed.' },
        { success: false },
        regenerate,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('regenerated');
    });

    it('flags past-tense miss claims against a successful verdict', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'Your blade bites deep.' });

      const outcome = await gateWithOutcome(
        { text: 'The strike went wide. Your attempt fell short.' },
        { success: true },
        regenerate,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('regenerated');
    });

    it('flags the named character succeeding against a failed verdict', async () => {
      const regenerate = vi.fn().mockResolvedValue({ text: 'You fail to stay quiet.' });

      const outcome = await gateWithOutcome(
        { text: 'Mira succeeded in climbing the shaft unnoticed.' },
        { success: false, characterName: 'Mira' },
        regenerate,
      );

      expect(regenerate).toHaveBeenCalledTimes(1);
      expect(outcome.outcome).toBe('regenerated');
    });
  });

  describe('gateRollOutcomeContradiction (#266 wiring)', () => {
    const ROLL_TS = '2026-10-10T02:49:00.000Z';
    const sessionId = 'session-1';

    /** The real reader, fed by a real roll_result combat-log entry. */
    const realGetOutcome = (sid: string): Promise<PersistedRollOutcome | null> => {
      vi.spyOn(SessionStateService, 'getState').mockResolvedValue({
        ...createDefaultSessionState(sid),
        combatLog: [
          {
            timestamp: ROLL_TS,
            entry: {
              kind: 'roll_result',
              payload: {
                success: false,
                total: 7,
                dc: 14,
                requestType: 'skill_check',
                description: 'Stealth check to climb the shaft unheard',
              },
            },
          },
        ],
      });
      return SessionStateService.getLatestRollOutcome(sid);
    };

    const dmHistory = (timestamp: string): ChatMessage[] => [
      {
        id: 'dm-1',
        role: 'assistant',
        content: 'Make a Stealth check.',
        speakerType: 'dm',
        timestamp: new Date(timestamp),
      } as ChatMessage,
    ];

    const wiring = (
      narration: { text: string },
      overrides: Partial<Parameters<typeof gateRollOutcomeContradiction>[0]> = {},
    ): Promise<{ text: string }> =>
      gateRollOutcomeContradiction({
        narration,
        sessionId,
        isDiceRollMessage: true,
        conversationHistory: [],
        getOutcome: realGetOutcome,
        runGate: vi.fn(async (_outcome, n) => n),
        ...overrides,
      });

    it('drives the gate on a dice-roll turn with a fresh contradicting outcome', async () => {
      const runGate = vi.fn(async (_outcome: unknown, n: { text: string }) => n);

      const result = await wiring({ text: 'You succeed without a sound.' }, { runGate });

      expect(runGate).toHaveBeenCalledTimes(1);
      expect(runGate.mock.calls[0][0]).toMatchObject({ success: false });
      expect(result.text).toBe('You succeed without a sound.');
    });

    it('skips the gate when the outcome is stale', async () => {
      const runGate = vi.fn(async (_outcome: unknown, n: { text: string }) => n);

      await wiring(
        { text: 'You succeed without a sound.' },
        { runGate, conversationHistory: dmHistory('2026-10-10T03:00:00.000Z') },
      );

      expect(runGate).not.toHaveBeenCalled();
    });

    it('skips the gate when the reply follows the verdict', async () => {
      const runGate = vi.fn(async (_outcome: unknown, n: { text: string }) => n);

      await wiring({ text: 'You fail to stay quiet.' }, { runGate });

      expect(runGate).not.toHaveBeenCalled();
    });

    it('never loads an outcome off the dice-roll branch', async () => {
      const getOutcome = vi.fn(async (_sid: string) => null);
      const runGate = vi.fn(async (_outcome: unknown, n: { text: string }) => n);

      await wiring(
        { text: 'You succeed without a sound.' },
        { getOutcome, runGate, isDiceRollMessage: false },
      );

      expect(getOutcome).not.toHaveBeenCalled();
      expect(runGate).not.toHaveBeenCalled();
    });
  });
});

describe('narrativeTurnHasNoEngineEvent', () => {
  const turn = {
    isInCombat: false,
    isDiceRollMessage: false,
    playerInputOrigin: 'typed' as const,
    result: { text: CLEAN, combat_transition: 'none' },
  };

  it('holds for a typed message the engine has nothing to resolve, with the envelope prod sends', () => {
    expect(narrativeTurnHasNoEngineEvent(turn)).toBe(true);
    expect(narrativeTurnHasNoEngineEvent({ ...turn, result: { text: CLEAN } })).toBe(true);
  });

  it.each([
    ['in combat', { isInCombat: true }],
    ['a dice result', { isDiceRollMessage: true }],
    ['no player message', { playerInputOrigin: null }],
    ['a roll request', { result: { text: CLEAN, roll_requests: [{}] } }],
    ['the legacy roll block', { result: { text: '```ROLL_REQUESTS_V1\n[]\n```' } }],
    ['a combat action', { result: { text: CLEAN, combat_actions: [{}] } }],
    ['combatants', { result: { text: CLEAN, combatants: [{}] } }],
    ['a combat start', { result: { text: CLEAN, combat_transition: 'start' } }],
    ['a pending entry', { result: { text: CLEAN, combat_entry_pending: {} } }],
    ['a seated entry', { result: { text: CLEAN, combat_entry: { entered: true } } }],
  ])('does not hold for %s', (_label, overrides) => {
    expect(narrativeTurnHasNoEngineEvent({ ...turn, ...overrides })).toBe(false);
  });
});
