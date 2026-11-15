/**
 * One damage type inside a hit's total (#1522): the weapon's, and a rider's (Divine Smite's radiant).
 *
 * Kept free of imports so the server's attack narration can use the same sentence the engine line
 * and the card use, without pulling in the transcript module's graph.
 */
export interface DamagePart {
  damageType: string;
  amount: number;
  /** The rider that added this part, e.g. "Divine Smite". Absent on the weapon's part. */
  source?: string;
  /** The rider's dice, e.g. "2d8". */
  dice?: string;
}

/**
 * `7 slashing + 11 radiant (Divine Smite 2d8) = 18 damage` for a hit split by type (#1522).
 * Null when there is no split (fewer than two parts, or no finite total), so the caller keeps
 * its single-type wording.
 */
export function damagePartsSentence(
  parts: readonly DamagePart[] | undefined,
  total: unknown,
): string | null {
  if (!parts || parts.length < 2 || typeof total !== 'number' || !Number.isFinite(total)) {
    return null;
  }
  const text = parts
    .map((part) => {
      const rider = part.source ? ` (${part.source}${part.dice ? ` ${part.dice}` : ''})` : '';
      return `${part.amount} ${part.damageType}${rider}`;
    })
    .join(' + ');
  return `${text} = ${total} damage`;
}
