import { createContext, useContext } from 'react';

/** #1643: the sheet character's hit points, as the sheet shows them. */
export interface SheetHitPoints {
  current: number;
  maximum: number;
}

/**
 * #1643: provided by the character sheet so the Lay on Hands control can see whether the hero is
 * already at full health. Without a provider the value is null and the control stays enabled.
 */
export const SheetHitPointsContext = createContext<SheetHitPoints | null>(null);

export const useSheetHitPointsOptional = (): SheetHitPoints | null =>
  useContext(SheetHitPointsContext);
