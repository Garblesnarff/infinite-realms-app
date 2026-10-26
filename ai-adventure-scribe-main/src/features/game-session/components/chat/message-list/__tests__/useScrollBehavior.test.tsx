import { act, renderHook } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScrollBehavior } from '../useScrollBehavior';

import type { ChatMessage } from '@/types/game';

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  observed: Element[] = [];

  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {}

  disconnect(): void {
    this.observed = [];
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const createContainer = (): { element: HTMLDivElement; messagesRef: RefObject<HTMLDivElement> } => {
  const element = document.createElement('div');
  Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 500 });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: 300 });
  document.body.appendChild(element);
  const messagesRef = createRef<HTMLDivElement>();
  (messagesRef as { current: HTMLDivElement | null }).current = element;
  return { element, messagesRef };
};

afterEach(() => {
  FakeResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

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

describe('useScrollBehavior content growth (#713)', () => {
  it('re-pins to the bottom when an observed child grows', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { element, messagesRef } = createContainer();
    const child = document.createElement('div');
    element.appendChild(child);

    const { unmount } = renderHook(() => useScrollBehavior(messagesRef, []));
    const observer = FakeResizeObserver.instances[0];
    expect(observer.observed).toContain(child);

    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 900 });
    act(() => observer.trigger());

    expect(element.scrollTop).toBe(900);
    unmount();
    element.remove();
  });

  it('does not move scrollTop when the user has scrolled up', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { element, messagesRef } = createContainer();
    const child = document.createElement('div');
    element.appendChild(child);

    const { unmount } = renderHook(() => useScrollBehavior(messagesRef, []));
    const observer = FakeResizeObserver.instances[0];

    element.scrollTop = 0;
    act(() => {
      element.dispatchEvent(new Event('scroll'));
    });

    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: 900 });
    act(() => observer.trigger());

    expect(element.scrollTop).toBe(0);
    unmount();
    element.remove();
  });

  it('follows within the 120 px threshold and holds still beyond it (#88)', () => {
    // Within 120 px of the bottom: a new message pulls the stream down.
    const near = createContainer();
    const nearHook = renderHook(
      ({ messages }: { messages: ChatMessage[] }) => useScrollBehavior(near.messagesRef, messages),
      { initialProps: { messages: [] as ChatMessage[] } },
    );
    near.element.scrollTop = 100; // 500 - 100 - 300 = 100 px from the bottom
    act(() => {
      near.element.dispatchEvent(new Event('scroll'));
    });
    act(() => {
      nearHook.rerender({ messages: [{ text: 'hi', sender: 'dm' }] });
    });
    expect(near.element.scrollTop).toBe(500);
    nearHook.unmount();
    near.element.remove();

    // Beyond 120 px: the stream holds still for the pill instead.
    const far = createContainer();
    const farHook = renderHook(
      ({ messages }: { messages: ChatMessage[] }) => useScrollBehavior(far.messagesRef, messages),
      { initialProps: { messages: [] as ChatMessage[] } },
    );
    far.element.scrollTop = 0; // 500 - 0 - 300 = 200 px from the bottom
    act(() => {
      far.element.dispatchEvent(new Event('scroll'));
    });
    act(() => {
      farHook.rerender({ messages: [{ text: 'hi', sender: 'dm' }] });
    });
    expect(far.element.scrollTop).toBe(0);
    farHook.unmount();
    far.element.remove();
  });

  it('observes a child appended after mount', async () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { element, messagesRef } = createContainer();

    const { unmount } = renderHook(() => useScrollBehavior(messagesRef, []));
    const observer = FakeResizeObserver.instances[0];

    const child = document.createElement('div');
    element.appendChild(child);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observer.observed).toContain(child);
    unmount();
    element.remove();
  });
});
