/**
 * The D&D 5e proficiency bonus progression, shared by the browser and Bun server.
 *
 * Character levels are bounded to the 2014 rules table so every producer agrees at the
 * level boundaries and for defensive out-of-range inputs.
 */
export function proficiencyBonus(level: number): number {
  // Missing or non-numeric levels fall back to level 1, as the sheet and engine callers always did.
  if (!Number.isFinite(level)) return 2;
  const boundedLevel = Math.min(20, Math.max(1, Math.floor(level)));
  return 2 + Math.floor((boundedLevel - 1) / 4);
}
