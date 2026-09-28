import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useMessageSendQueue } from '../use-message-send-queue';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const CAST = 'I cast Chill Touch [spell_id=chill-touch, spell_level=cantrip].';
const CAST_CONTEXT = { intent: 'spell_cast' as const, spellId: 'chill-touch', spellLevel: 0 };

/** A send that stays in flight until the test releases it. */
function holdSends() {
  const sent: string[] = [];
  const releases: Array<() => void> = [];
  const send = vi.fn(async (input: string) => {
    sent.push(input);
    await new Promise<void>((resolve) => releases.push(resolve));
  });
  return { sent, releases, send };
}

describe('the player send queue (#2305)', () => {
  it('plays a second identical Cast during the first as the same turn, not a new one', async () => {
    const { result } = renderHook(() => useMessageSendQueue());
    const { sent, releases, send } = holdSends();
    result.current.actualSendMessageRef.current = send;

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleSendMessage(CAST, CAST_CONTEXT);
      second = result.current.handleSendMessage(CAST, CAST_CONTEXT);
    });
    await act(async () => {
      releases[0]();
      await Promise.all([first, second]);
    });

    // Run M7: the duplicate became round 2's player turn and the engine cast for the player.
    expect(sent).toEqual([CAST]);
  });

  it('still sends the same cantrip again once the first turn has finished', async () => {
    const { result } = renderHook(() => useMessageSendQueue());
    const { sent, releases, send } = holdSends();
    result.current.actualSendMessageRef.current = send;

    let first!: Promise<void>;
    act(() => {
      first = result.current.handleSendMessage(CAST, CAST_CONTEXT);
    });
    await act(async () => {
      releases[0]();
      await first;
    });
    let again!: Promise<void>;
    act(() => {
      again = result.current.handleSendMessage(CAST, CAST_CONTEXT);
    });
    await act(async () => {
      releases[1]();
      await again;
    });

    expect(sent).toEqual([CAST, CAST]);
  });

  it('keeps different messages queued behind one another', async () => {
    const { result } = renderHook(() => useMessageSendQueue());
    const { sent, releases, send } = holdSends();
    result.current.actualSendMessageRef.current = send;

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.handleSendMessage(CAST, CAST_CONTEXT);
      second = result.current.handleSendMessage('I step back.');
    });
    await act(async () => {
      releases[0]();
      await first;
    });
    await act(async () => {
      releases[1]();
      await second;
    });

    expect(sent).toEqual([CAST, 'I step back.']);
  });
});
