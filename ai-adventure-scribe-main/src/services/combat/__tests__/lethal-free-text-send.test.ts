import { beforeEach, describe, expect, it, vi } from 'vitest';

import { decideLethalFreeTextSend } from '../lethal-free-text-send';

import type { LethalActResponse } from '../lethal-act-api';

const engineResult = (overrides: Partial<LethalActResponse> = {}): LethalActResponse => ({
  success: true,
  natural: 15,
  modifier: 0,
  total: 15,
  dc: 15,
  damage: 0,
  vitalState: 'standing',
  currentHitPoints: 20,
  maxHitPoints: 20,
  engineCard: {
    kind: 'check',
    side: 'party',
    line: 'Dexterity saving throw: 15 vs DC 15, SUCCESS',
    title: 'Dexterity saving throw',
  },
  ...overrides,
});

describe('decideLethalFreeTextSend (#468)', () => {
  const confirm = vi.fn();
  const resolve = vi.fn();

  beforeEach(() => {
    confirm.mockReset();
    resolve.mockReset();
  });

  it('asks to confirm a clearly lethal act, then the engine decides on yes', async () => {
    confirm.mockResolvedValue(true);
    resolve.mockResolvedValue(engineResult());

    const decision = await decideLethalFreeTextSend({
      text: 'I step off the edge to my death',
      inCombat: false,
      sessionId: 'sess-1',
      confirm,
      resolve,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('sess-1', 'I step off the edge to my death');
    expect(decision).toEqual({ kind: 'engine', result: engineResult() });
  });

  it('cancels without sending anything when the player says no', async () => {
    confirm.mockResolvedValue(false);

    const decision = await decideLethalFreeTextSend({
      text: 'I step off the edge to my death',
      inCombat: false,
      sessionId: 'sess-1',
      confirm,
      resolve,
    });

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(resolve).not.toHaveBeenCalled();
    expect(decision).toEqual({ kind: 'cancelled' });
  });

  it('does not prompt in a fight, or for ordinary text, or for a roll answer', async () => {
    const ordinary = await decideLethalFreeTextSend({
      text: 'I look over the edge',
      inCombat: false,
      sessionId: 'sess-1',
      confirm,
      resolve,
    });
    const inFight = await decideLethalFreeTextSend({
      text: 'I step off the edge to my death',
      inCombat: true,
      sessionId: 'sess-1',
      confirm,
      resolve,
    });
    const roll = await decideLethalFreeTextSend({
      text: 'I step off the edge to my death',
      inCombat: false,
      intent: 'dice_roll',
      sessionId: 'sess-1',
      confirm,
      resolve,
    });
    expect(ordinary).toEqual({ kind: 'send-normal' });
    expect(inFight).toEqual({ kind: 'send-normal' });
    expect(roll).toEqual({ kind: 'send-normal' });
    expect(confirm).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
  });
});
