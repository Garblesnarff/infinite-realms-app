import { act, renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { useScrollBehavior } from '../useScrollBehavior';

describe('useScrollBehavior combat entry', () => {
  it('pins the transcript to its newest line when combat starts', () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
    document.body.appendChild(element);
    const messagesRef = createRef<HTMLDivElement>();
    (messagesRef as { current: HTMLDivElement | null }).current = element;

    const { rerender, unmount } = renderHook(
      ({ isInCombat }) => useScrollBehavior(messagesRef, [], false, undefined, false, isInCombat),
      { initialProps: { isInCombat: false } },
    );

    element.scrollTop = 240;
    act(() => rerender({ isInCombat: true }));

    expect(element.scrollTop).toBe(1200);
    unmount();
    element.remove();
  });
});
