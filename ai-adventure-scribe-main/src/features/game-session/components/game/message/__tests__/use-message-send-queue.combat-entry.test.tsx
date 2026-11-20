import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMessageSendQueue } from '../use-message-send-queue';

import {
  hasPendingCombatEntryConfirmation,
  requestCombatEntryAnswer,
  setCombatEntryConfirmationHost,
} from '@/services/combat/combat-entry-confirmation-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type SendContext = NonNullable<
  Parameters<ReturnType<typeof useMessageSendQueue>['handleSendMessage']>[1]
>;

const ATTACK = 'I attack the goblin with my shortsword.';
const SAVE = 'Dexterity save: 14';
const ROLL_CONTEXT = {
  intent: 'dice_roll',
  rollRequestId: 'roll-1',
} as unknown as SendContext;

describe('a roll answer queued behind a fight prompt (#1678)', () => {
  it('is sent once, and only after the fight prompt is answered', async () => {
    const card: { settle?: (confirmed: boolean) => void } = {};
    setCombatEntryConfirmationHost({
      present: (_spec, settle) => {
        card.settle = settle;
        return () => {};
      },
    });
    const sent: string[] = [];
    const send = vi.fn(async (input: string, context?: SendContext) => {
      sent.push(`${context?.intent ?? 'typed'}:${input}`);
      if (input === ATTACK) {
        await requestCombatEntryAnswer({
          actorLabel: 'Rook',
          combatantLabels: ['Goblin'],
          initiativeRoll: null,
          initiativeModifier: 1,
        });
      }
    });

    const { result } = renderHook(() => useMessageSendQueue());
    result.current.actualSendMessageRef.current = send;

    let attack!: Promise<void>;
    let roll!: Promise<void>;
    act(() => {
      attack = result.current.handleSendMessage(ATTACK);
      roll = result.current.handleSendMessage(SAVE, ROLL_CONTEXT);
    });

    expect(hasPendingCombatEntryConfirmation()).toBe(true);
    expect(sent).toEqual([`typed:${ATTACK}`]);

    await act(async () => {
      card.settle?.(true);
      await Promise.all([attack, roll]);
    });

    expect(sent).toEqual([`typed:${ATTACK}`, `dice_roll:${SAVE}`]);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
