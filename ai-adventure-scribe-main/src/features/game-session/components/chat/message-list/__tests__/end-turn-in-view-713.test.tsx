import { act, render, screen } from '@testing-library/react';
import React, { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useScrollBehavior } from '../useScrollBehavior';

import type { ActionOption } from '@/utils/parseMessageOptions';

import { ActionOptions } from '@/components/game/ActionOptions';

// #713: the combat menu arrives after the DM message, as DynamicOptionsSection's legal-action
// fetch does, so the scroll box grows after the auto-scroll ran.
const COMBAT_MENU: ActionOption[] = [
  'Attack',
  'Cast a spell',
  'Dash',
  'Dodge',
  'Move',
  'End turn',
].map((text, index) => ({ id: `combat-${index}`, number: index + 1, text, fullText: text }));

const observers: Array<{ callback: ResizeObserverCallback; observed: Element[] }> = [];

class RecordingResizeObserver {
  observed: Element[] = [];
  constructor(public callback: ResizeObserverCallback) {
    observers.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {}
  disconnect(): void {}
}

function Transcript({ options }: { options: ActionOption[] }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useScrollBehavior(ref, [], false, undefined, false, true);
  return (
    <div ref={ref} data-testid="chat-scroll">
      <div>
        <p>The goblin raider circles the brazier.</p>
        <ActionOptions options={options} onOptionSelect={() => {}} delay={0} />
      </div>
    </div>
  );
}

afterEach(() => {
  observers.length = 0;
  vi.unstubAllGlobals();
});

describe('End turn stays in view when the combat menu loads late (#713)', () => {
  it('scrolls the transcript to the End turn row once the menu renders', async () => {
    vi.stubGlobal('ResizeObserver', RecordingResizeObserver);
    const { rerender } = render(<Transcript options={[]} />);
    const scroller = screen.getByTestId('chat-scroll');
    Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 300 });

    rerender(<Transcript options={COMBAT_MENU} />);
    expect(await screen.findByRole('button', { name: /End turn/ })).toBeTruthy();

    // The menu made the content taller; the browser reports that on the content row.
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 760 });
    const observer = observers[0];
    expect(observer.observed).toContain(scroller.firstElementChild);
    act(() => observer.callback([], observer as unknown as ResizeObserver));

    expect(scroller.scrollTop).toBe(760);
  });
});
