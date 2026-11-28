/**
 * Pure death-save resolution for a hero dying outside combat (#1811).
 *
 * Reuses `HPMechanics.resolveDeathSave` for the tally math; this module only
 * maps the result onto character vitals and the engine lines. Free of the
 * database client so unit tests can call it without DATABASE_URL.
 */

import {
  describeDeathSave,
  describeDeathSaveRollLine,
} from '../../../../shared/death-save-lines.js';
import { HPMechanics } from '../combat/hp-mechanics.js';

import type { VitalState } from '../../../../db/schema/index';
import type { CharacterVitals, VitalsWrite } from '../character-vitals-math.js';

export interface DeathSaveResolution {
  roll: number;
  natural: number;
  isSuccess: boolean;
  isCritical: boolean;
  successes: number;
  failures: number;
  isStabilized: boolean;
  isDead: boolean;
  wasRevived: boolean;
  newCurrentHp: number;
  vitalState: VitalState;
  diedAt: Date | null;
  hours: number | null;
  vitals: VitalsWrite;
  lines: string[];
}

/** The wake line after three successes, with the engine's 1d4 hours filled in. */
export function describeOutOfCombatWake(name: string, hours: number): string {
  const unit = hours === 1 ? 'hour' : 'hours';
  return `${name} is stable. After ${hours} ${unit} ${name} wakes with 1 HP.`;
}

export function resolveDeathSave(input: {
  vitals: CharacterVitals;
  name: string;
  natural: number;
  d4?: number;
}): DeathSaveResolution {
  const result = HPMechanics.resolveDeathSave(
    input.vitals.characterId,
    {
      currentHp: input.vitals.currentHitPoints,
      maxHp: input.vitals.maxHitPoints,
      tempHp: input.vitals.temporaryHitPoints,
      isConscious: input.vitals.isConscious,
      deathSavesSuccesses: input.vitals.deathSavesSuccesses,
      deathSavesFailures: input.vitals.deathSavesFailures,
    },
    input.natural,
  );

  let vitalState: VitalState;
  let newCurrentHp = result.newCurrentHp;
  let diedAt: Date | null = null;
  let hours: number | null = null;
  const lines: string[] = [];

  if (result.wasRevived) {
    vitalState = 'standing';
    newCurrentHp = 1;
    lines.push(describeDeathSave(input.name, result));
  } else if (result.isDead) {
    vitalState = 'dead';
    newCurrentHp = 0;
    diedAt = new Date();
    lines.push(describeDeathSave(input.name, result));
  } else if (result.isStabilized) {
    vitalState = 'standing';
    newCurrentHp = 1;
    hours = input.d4 ?? 0;
    lines.push(describeDeathSave(input.name, result));
    lines.push(describeOutOfCombatWake(input.name, hours));
  } else {
    vitalState = 'dying';
    newCurrentHp = 0;
    const rollLine = describeDeathSaveRollLine(result);
    lines.push(rollLine ?? describeDeathSave(input.name, result));
  }

  const vitals: VitalsWrite = {
    currentHitPoints: newCurrentHp,
    temporaryHitPoints: input.vitals.temporaryHitPoints,
    isConscious: vitalState === 'standing',
    vitalState,
    deathSavesSuccesses: result.successes,
    deathSavesFailures: result.failures,
    ...(diedAt ? { diedAt } : {}),
  };

  return {
    roll: input.natural,
    natural: input.natural,
    isSuccess: result.isSuccess,
    isCritical: result.isCritical,
    successes: result.successes,
    failures: result.failures,
    isStabilized: result.isStabilized,
    isDead: result.isDead,
    wasRevived: result.wasRevived,
    newCurrentHp,
    vitalState,
    diedAt,
    hours,
    vitals,
    lines,
  };
}
