/**
 * `2nd`, `3rd`, `4th`: a spell-slot level as the PHB writes it (#1206).
 *
 * Single owner: client and server import from here. No other copy of
 * `slotOrdinal` may exist.
 *
 * @module shared/slot-ordinal
 */

/** A spell-slot level as the PHB writes it (`2nd`, `3rd`, `4th`). */
export function slotOrdinal(level: number): string {
  if (level === 1) return '1st';
  if (level === 2) return '2nd';
  if (level === 3) return '3rd';
  return `${level}th`;
}
