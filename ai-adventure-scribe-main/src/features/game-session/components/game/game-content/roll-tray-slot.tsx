import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The roll tray's place in the page: an element in the center column's normal flow, between
 * the story stream and the chat box (#2252). GameMainContent owns the element; the roll
 * prompt is still rendered by the message list, which owns the dice queue and the roll host,
 * and is portaled here. Nothing is fixed, absolute or sticky, so nothing can cover it and
 * the stream above it shrinks to make room.
 */
const RollTraySlotContext = createContext<HTMLElement | null>(null);

export const RollTraySlotProvider = RollTraySlotContext.Provider;

/**
 * Renders the roll prompt into the tray slot. Without a slot (a message list rendered outside
 * the game screen), it renders in place, still in normal flow.
 */
export function RollTray({ children }: { children: ReactNode }): ReactElement {
  const slot = useContext(RollTraySlotContext);
  const tray = (
    <div data-testid="roll-tray" className="w-full">
      {children}
    </div>
  );
  return slot ? createPortal(tray, slot) : tray;
}
