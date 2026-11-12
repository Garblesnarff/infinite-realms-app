import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

import '@/styles/ir-table-parts.css';

/**
 * The roll tray's place in the page: an element in the center column's normal flow, between
 * the story stream and the chat box (#2252). GameMainContent owns the element; the roll
 * prompt is still rendered by the message list, which owns the dice queue and the roll host,
 * and is portaled here. Nothing is fixed, absolute or sticky, so nothing can cover it and
 * the stream above it shrinks to make room.
 */
const RollTraySlotContext = createContext<HTMLElement | null>(null);

export const RollTraySlotProvider = RollTraySlotContext.Provider;

/** The closed lid's text, shown on the Table host only while no roll is pending. */
export const TRAY_LID_TEXT = 'It opens when the DM asks for a roll.';

/**
 * Move one persistent portal target between layouts without unmounting a pending roll. On the
 * Table host (`ir-table-roll-host`) the closed lid's text is a real element in front of the slot;
 * CSS shows it only while the slot is empty, so screen readers get the text and it is hidden
 * the rest of the time. Other hosts get the slot alone.
 */
export function useStableRollTraySlot(host: HTMLElement | null): HTMLElement | null {
  const [parts] = useState(() => {
    if (typeof document === 'undefined') return null;
    const slot = document.createElement('div');
    slot.className = 'ir-stable-roll-slot';
    const lid = document.createElement('p');
    lid.className = 'ir-roll-tray-lid';
    lid.textContent = TRAY_LID_TEXT;
    return { slot, lid };
  });
  useLayoutEffect(() => {
    if (!host || !parts) return undefined;
    const withLid = host.classList.contains('ir-table-roll-host');
    if (withLid) host.appendChild(parts.lid);
    host.appendChild(parts.slot);
    return () => parts.lid.remove();
  }, [host, parts]);
  useEffect(() => () => parts?.slot.remove(), [parts]);
  return parts?.slot ?? null;
}

/**
 * Renders the roll prompt into the tray slot. Without a slot (a message list rendered outside
 * the game screen), it renders in place, still in normal flow.
 */
export function RollTray({ children }: { children: ReactNode }): ReactElement {
  const slot = useContext(RollTraySlotContext);
  const tray = (
    <div
      data-testid="roll-tray"
      className="ir-table-walnut w-full [body.ir-table-look_&]:rounded-lg [body.ir-table-look_&]:border-4 [body.ir-table-look_&]:border-[#3b2616] [body.ir-table-look_&]:p-1"
    >
      {children}
    </div>
  );
  return slot ? createPortal(tray, slot) : tray;
}
