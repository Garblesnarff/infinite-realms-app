import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NEUTRAL_NO_EFFECT_LINE,
  enforceNarrationGate,
  narrationViolationNote,
  narrativeTurnHasNoEngineEvent,
  releaseHeldSideEffects,
} from '../narration-gate';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { lastRequestId: vi.fn(() => 'req-1') },
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
