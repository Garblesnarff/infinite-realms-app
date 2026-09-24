/**
 * rpg-dice-roller's `roll.rolls` mixes die groups with operator strings and
 * bare modifier numbers (`[RollResults, "+", 4]`). Reading `.value` off those
 * primitives yields NaN, which the dialog then prints as "Base: 11+0".
 * Keep die faces, and carry each group's "+" / "-" so a subtracted pool
 * (1d8+1d6-1d4) is not later shown as three positive faces.
 */

export interface ParsedDieFace {
  dice: number;
  value: number;
  /** +1 for a normal group, -1 when the expression subtracts that group. */
  sign: 1 | -1;
  critical?: boolean;
}

interface FaceLike {
  value: number;
  useInTotal?: boolean;
}

function dieGroupSides(expression: string): number[] {
  const sides: number[] = [];
  for (const match of expression.matchAll(/d(\d+)/gi)) {
    sides.push(Number.parseInt(match[1], 10));
  }
  return sides;
}

function isFace(value: unknown): value is FaceLike {
  return (
    !!value &&
    typeof value === 'object' &&
    'value' in value &&
    typeof (value as { value: unknown }).value === 'number' &&
    Number.isFinite((value as { value: number }).value)
  );
}

export function parseLibraryRoll(parts: Iterable<unknown>, expression: string): ParsedDieFace[] {
  const groupSides = dieGroupSides(expression);
  const faces: ParsedDieFace[] = [];
  let groupIndex = 0;
  let sign: 1 | -1 = 1;

  for (const part of parts) {
    if (typeof part === 'string') {
      const token = part.trim();
      if (token === '-') sign = -1;
      else if (token === '+') sign = 1;
      continue;
    }
    if (typeof part === 'number') {
      sign = 1;
      continue;
    }
    if (!part || typeof part !== 'object' || !('rolls' in part)) continue;
    const group = part as { rolls?: Iterable<unknown>; sides?: number };
    if (!group.rolls) continue;

    const sides = typeof group.sides === 'number' ? group.sides : (groupSides[groupIndex] ?? 20);
    groupIndex += 1;

    for (const face of group.rolls) {
      if (!isFace(face) || face.useInTotal === false) continue;
      faces.push({
        dice: sides,
        value: face.value,
        sign,
        critical: sides === 20 && (face.value === 1 || face.value === 20),
      });
    }
    sign = 1;
  }

  return faces;
}
