type ClassLevel = { className: string; level: number };

/** Number of weapon attacks in one Attack action under the 2014 class progression. */
export function attackActionSwings(character: {
  class: string | null;
  level: number | null;
  classLevels: unknown;
}): number {
  const levels: ClassLevel[] = Array.isArray(character.classLevels)
    ? character.classLevels.filter(
        (entry: unknown): entry is ClassLevel =>
          !!entry &&
          typeof entry === 'object' &&
          typeof (entry as ClassLevel).className === 'string' &&
          typeof (entry as ClassLevel).level === 'number',
      )
    : [];
  if (levels.length === 0 && character.class) {
    levels.push({ className: character.class, level: character.level ?? 1 });
  }
  return Math.max(
    1,
    ...levels.map(({ className, level }) => {
      const name = className.toLowerCase();
      if (name === 'fighter') return level >= 20 ? 4 : level >= 11 ? 3 : level >= 5 ? 2 : 1;
      return ['barbarian', 'monk', 'paladin', 'ranger'].includes(name) && level >= 5 ? 2 : 1;
    }),
  );
}

export interface AttackActionBudget {
  encounterId: string;
  participantId: string;
  round: number;
  remaining: number;
  capacity: number;
}

/** Decide which action pays for a swing; persistence and version claims stay with the caller. */
export function planAttackSwing(input: {
  encounterId: string;
  participantId: string;
  round: number;
  capacity: number;
  actionUsed: boolean;
  surgeArmed: boolean;
  budget: AttackActionBudget | null;
}): { budget: AttackActionBudget; payment: 'action' | 'remaining' | 'surge' } | null {
  const { encounterId, participantId, round, capacity, actionUsed, surgeArmed, budget } = input;
  const matching =
    budget?.encounterId === encounterId &&
    budget.participantId === participantId &&
    budget.round === round;
  if (!actionUsed) {
    return {
      budget: { encounterId, participantId, round, capacity, remaining: capacity - 1 },
      payment: 'action',
    };
  }
  if (matching && budget.remaining > 0) {
    return { budget: { ...budget, remaining: budget.remaining - 1 }, payment: 'remaining' };
  }
  if (surgeArmed) {
    return {
      budget: { encounterId, participantId, round, capacity, remaining: capacity - 1 },
      payment: 'surge',
    };
  }
  return null;
}
