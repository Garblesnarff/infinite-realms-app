export const CARRYING_CAPACITY_MULTIPLIERS = {
  TINY: 0.5,
  SMALL: 1,
  MEDIUM: 1,
  LARGE: 2,
  HUGE: 4,
  GARGANTUAN: 8,
} as const;

export const PUSH_DRAG_LIFT_CAPACITY_MULTIPLIER = 2;

export const ENCUMBRANCE_THRESHOLDS = {
  NORMAL: 1,
  ENCUMBERED: 5,
  HEAVILY_ENCUMBERED: 10,
} as const;

export const carryingCapacityForStrength = (strength: number): number => strength * 15;

export type CarryingCapacitySize = keyof typeof CARRYING_CAPACITY_MULTIPLIERS;

export const carryingCapacityForStrengthAndSize = (
  strength: number,
  size: CarryingCapacitySize,
): number => carryingCapacityForStrength(strength) * CARRYING_CAPACITY_MULTIPLIERS[size];

export const pushDragLiftCapacityForStrength = (strength: number): number =>
  carryingCapacityForStrength(strength) * PUSH_DRAG_LIFT_CAPACITY_MULTIPLIER;
