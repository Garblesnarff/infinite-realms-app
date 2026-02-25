/**
 * Utility functions for hit point (HP) related UI logic
 */

/**
 * Returns a semantic Tailwind background color class based on HP percentage
 * - Green (> 50%): Healthy
 * - Yellow (25% - 50%): Bloodied/Wounded
 * - Red (< 25%): Critical
 *
 * @param percent HP percentage (0-100)
 * @returns Tailwind background color class
 */
export const getHPColor = (percent: number): string => {
  if (percent <= 25) return 'bg-red-500';
  if (percent <= 50) return 'bg-yellow-500';
  return 'bg-green-500';
};
