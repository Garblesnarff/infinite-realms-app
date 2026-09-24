/**
 * Player-facing math for a finished roll.
 * A 1d20+4 that landed 7 reads "7 + 4 = 11".
 * A subtracted group keeps its sign: 1d8+1d6-1d4 (8, 4, 2) reads "8 + 4 - 2 = 10".
 */
export function formatRollBreakdown(result: {
  rolls: Array<{ value: number; sign?: number }>;
  modifiers: number;
  total: number;
}): string {
  const parts: string[] = [];
  for (const roll of result.rolls) {
    if (!Number.isFinite(roll.value)) continue;
    const negative = roll.sign === -1;
    if (parts.length === 0) {
      parts.push(negative ? `- ${roll.value}` : String(roll.value));
    } else {
      parts.push(negative ? `- ${roll.value}` : `+ ${roll.value}`);
    }
  }
  if (Number.isFinite(result.modifiers) && result.modifiers !== 0) {
    parts.push(result.modifiers < 0 ? `- ${Math.abs(result.modifiers)}` : `+ ${result.modifiers}`);
  }
  const left = parts.length > 0 ? parts.join(' ') : '0';
  return `${left} = ${result.total}`;
}
