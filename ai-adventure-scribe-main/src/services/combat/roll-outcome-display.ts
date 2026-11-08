/** A display result is published only after the combat engine resolves the matching roll. */
export interface EngineRollOutcome {
  rollId: string;
  kind: 'attack' | 'check';
  d20: number;
  total: number;
  bonus: number;
  blessDie?: number;
  hit?: boolean;
  success?: boolean;
  isCritical: boolean;
}

const outcomes = new Map<string, EngineRollOutcome>();
const listeners = new Set<(outcome: EngineRollOutcome) => void>();

export function engineRollOutcome(rollId: string): EngineRollOutcome | undefined {
  return outcomes.get(rollId);
}

export function subscribeEngineRollOutcome(
  listener: (outcome: EngineRollOutcome) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function publishEngineRollOutcome(rollId: string | undefined, result: unknown): void {
  if (!rollId || !result || typeof result !== 'object') return;
  const value = result as Record<string, unknown>;
  const actorRoll = value.actorRoll;
  let outcome: EngineRollOutcome;
  if (actorRoll && typeof actorRoll === 'object' && typeof value.success === 'boolean') {
    const actor = actorRoll as Record<string, unknown>;
    if (
      typeof actor.d20 !== 'number' ||
      typeof actor.modifier !== 'number' ||
      typeof actor.total !== 'number'
    )
      return;
    outcome = {
      rollId,
      kind: 'check',
      d20: actor.d20,
      bonus: actor.modifier,
      total: actor.total,
      success: value.success,
      isCritical: false,
    };
  } else {
    const candidates = Array.isArray(value.results) ? value.results : [value];
    if (candidates.length !== 1) return;
    const match = candidates[0];
    if (!match || typeof match !== 'object') return;
    const attack = match as Record<string, unknown>;
    if (
      typeof attack.d20 !== 'number' ||
      typeof attack.attackBonus !== 'number' ||
      typeof attack.totalAttackRoll !== 'number' ||
      typeof attack.hit !== 'boolean'
    )
      return;
    outcome = {
      rollId,
      kind: 'attack',
      d20: attack.d20,
      total: attack.totalAttackRoll,
      bonus: attack.attackBonus,
      ...(typeof attack.blessDie === 'number' ? { blessDie: attack.blessDie } : {}),
      hit: attack.hit,
      isCritical: attack.isCritical === true,
    };
  }
  outcomes.set(rollId, outcome);
  if (outcomes.size > 32) outcomes.delete(outcomes.keys().next().value as string);
  listeners.forEach((listener) => listener(outcome));
}
