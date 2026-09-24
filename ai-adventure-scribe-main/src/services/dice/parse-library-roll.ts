/**
 * rpg-dice-roller's `roll.rolls` mixes die groups with operator strings and
 * bare modifier numbers (`[RollResults, "+", 4]`). Reading `.value` off those
 * primitives yields NaN, which the dialog then prints as "Base: 11+0".
 * Keep only die faces, and derive the modifier from total − face sum.
 */

export interface ParsedDieFace {
  dice: number;
  value: number;
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

  for (const part of parts) {
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
        critical: sides === 20 && (face.value === 1 || face.value === 20),
      });
    }
  }

  return faces;
}
