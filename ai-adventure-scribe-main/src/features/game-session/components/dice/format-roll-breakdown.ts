/**
 * Player-facing math for a finished roll: die faces, then the modifier, then the total.
 * Example: a 1d20+4 that landed 7 reads "7 + 4 = 11".
 */
export function formatRollBreakdown(result: {
  rolls: Array<{ value: number }>;
  modifiers: number;
  total: number;
}): string {
  const faces = result.rolls.map((roll) => roll.value).filter((value) => Number.isFinite(value));
  const dieText = faces.length > 0 ? faces.join(' + ') : '0';
  const modifier = Number.isFinite(result.modifiers) ? result.modifiers : 0;
  const modifierText = modifier < 0 ? `- ${Math.abs(modifier)}` : `+ ${modifier}`;
  return `${dieText} ${modifierText} = ${result.total}`;
}
