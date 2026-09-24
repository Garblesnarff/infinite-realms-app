import { renderHook, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  COMBAT_SUMMARY_FALLBACK_MS,
  useDeferredCombatSummary,
} from '../use-deferred-combat-summary';

import type { CombatEncounter } from '@/types/combat-encounter';
import type { ChatMessage } from '@/types/game';

const encounter = { currentRound: 3, participants: [], actions: [] } as unknown as CombatEncounter;

const dm = (id: string, combatEnded = false): ChatMessage => ({
  id,
  text: `DM ${id}`,
  sender: 'dm',
  context: combatEnded ? { combatEnded: true } : {},
});

type Props = { isInCombat: boolean; messages: ChatMessage[]; messagesLoading?: boolean };

describe('useDeferredCombatSummary', () => {
  const sendMessage = vi.fn();
  const onCombatEnded = vi.fn();

  const setup = (initial: Props): RenderHookResult<void, Props> =>
    renderHook(
      (props: Props) =>
        useDeferredCombatSummary({
          ...props,
          activeEncounter: props.isInCombat ? encounter : null,
          sendMessage,
          onCombatEnded,
        }),
      { initialProps: initial },
    );

  const summaries = (): Array<[ChatMessage]> =>
    sendMessage.mock.calls.filter(([message]) => message.text === 'Combat has ended.') as Array<
      [ChatMessage]
    >;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockReset();
    onCombatEnded.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the terminal DM message, then posts the summary after it', () => {
    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    rerender({ isInCombat: false, messages: [dm('a')] });
    expect(onCombatEnded).toHaveBeenCalledTimes(1);
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('a'), dm('kill', true)] });
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0][0].context).toMatchObject({
      combatData: { type: 'summary', summary: { rounds: 3 } },
    });
  });

  it("ignores an earlier fight's terminal message in the same session", () => {
    const firstFight = [dm('a'), dm('kill-1', true)];
    const { rerender } = setup({ isInCombat: false, messages: firstFight });

    rerender({ isInCombat: true, messages: firstFight });
    rerender({ isInCombat: true, messages: [...firstFight, dm('b')] });
    rerender({ isInCombat: false, messages: [...firstFight, dm('b')] });
    // The first fight's combatEnded message is still in the transcript. It must not release the
    // second fight's summary ahead of its own killing blow.
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [...firstFight, dm('b'), dm('kill-2', true)] });
    expect(summaries()).toHaveLength(1);
  });

  it('accepts a terminal message that landed just before combat state flipped', () => {
    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    rerender({ isInCombat: true, messages: [dm('a'), dm('kill', true)] });
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('a'), dm('kill', true)] });
    expect(summaries()).toHaveLength(1);
  });

  it('posts the summary after the fallback when the terminal message never arrives', () => {
    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    rerender({ isInCombat: false, messages: [dm('a')] });
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS - 1);
    expect(summaries()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(summaries()).toHaveLength(1);

    // A late terminal message after the fallback does not post a second summary.
    rerender({ isInCombat: false, messages: [dm('a'), dm('kill', true)] });
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS);
    expect(summaries()).toHaveLength(1);
  });

  it('does not post twice when the terminal message beats the fallback', () => {
    const { rerender } = setup({ isInCombat: true, messages: [] });

    rerender({ isInCombat: false, messages: [] });
    rerender({ isInCombat: false, messages: [dm('kill', true)] });
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS * 2);

    expect(summaries()).toHaveLength(1);
  });

  it('treats history hydrated during a reloaded fight as an earlier fight', () => {
    const { rerender } = setup({ isInCombat: true, messages: [], messagesLoading: true });

    rerender({ isInCombat: true, messages: [dm('old-kill', true)], messagesLoading: true });
    rerender({ isInCombat: true, messages: [dm('old-kill', true)], messagesLoading: false });
    rerender({ isInCombat: false, messages: [dm('old-kill', true)] });
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('old-kill', true), dm('kill', true)] });
    expect(summaries()).toHaveLength(1);
  });
});
