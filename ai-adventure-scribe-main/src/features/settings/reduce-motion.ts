import type { ReduceMotion } from './table-settings';

/**
 * What the player should get. `system` follows the device. `on` forces reduced
 * motion. `off` allows motion even when the device asks to reduce it.
 */
export const effectiveReduceMotion = (setting: ReduceMotion, systemReduced: boolean): boolean => {
  if (setting === 'on') return true;
  if (setting === 'off') return false;
  return systemReduced;
};

/** Applies the override on the document. `system` leaves the CSS media query in charge. */
export const applyReduceMotion = (setting: ReduceMotion): void => {
  const root = document.documentElement;
  if (setting === 'system') {
    delete root.dataset.reduceMotion;
    return;
  }
  root.dataset.reduceMotion = setting;
};
