/**
 * Player-facing math for a finished roll. Every resolved roll display uses it.
 * A 1d20+4 that landed 7 reads "7 + 4 = 11" until the roll is a single kept d20
 * with a natural face: then each value is labelled, "Natural 7 + Modifier +4 = Total 11".
 * A negative modifier is subtracted: "Natural 9 \u2212 Modifier 1 = Total 8".
 * With advantage or disadvantage the kept die is named and the dropped one shown:
 * "Natural 15 (kept, 10 dropped) + Modifier +1 = Total 16".
 * A subtracted group keeps its sign: 1d8+1d6-1d4 (8, 4, 2) reads "8 + 4 - 2 = 10".
 */
export function formatRollBreakdown(result: {
  rolls: Array<{ value: number; sign?: number; useInTotal?: boolean }>;
  modifiers: number;
  total: number;
  naturalRoll?: number;
  advantage?: boolean;
  disadvantage?: boolean;
}): string {
  const counted = result.rolls.filter(
    (roll) => roll.useInTotal !== false && Number.isFinite(roll.value),
  );
  if (Number.isFinite(result.naturalRoll) && counted.length === 1) {
    const dropped = result.rolls.filter((roll) => roll.useInTotal === false);
    const edge = result.advantage || result.disadvantage;
    const kept = edge
      ? ` (kept${dropped.length > 0 ? `, ${dropped.map((roll) => roll.value).join(', ')} dropped` : ''})`
      : '';
    const modifier =
      result.modifiers < 0
        ? `\u2212 Modifier ${Math.abs(result.modifiers)}`
        : `+ Modifier +${result.modifiers}`;
    return `Natural ${result.naturalRoll}${kept} ${modifier} = Total ${result.total}`;
  }

  const parts: string[] = [];
  for (const roll of counted) {
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
