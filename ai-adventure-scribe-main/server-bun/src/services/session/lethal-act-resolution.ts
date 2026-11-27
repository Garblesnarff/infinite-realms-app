/**
 * #468 item 2: after the player confirms a clearly lethal free-text act,
 * the engine (not the DM's narration) rolls a saving throw or check and
 * decides the outcome. The DM (or a stub, or the 2014 default below)
 * proposes which roll and the DC; only this result can kill or harm.
 *
 * A live model proposal is not wired here: the generate route (llm.ts) is
 * owned by an open PR. The default proposal follows 2014 typical Hard DC 15.
 */
import { abilityModifier } from '../../../../shared/ability-modifier.js';
import {
  computeVitalsAfterDamage,
  type CharacterVitals,
  type VitalsWrite,
} from '../character-vitals-math.js';

import type { EngineResultCard } from '../../../../shared/engine-result-card.js';

export type LethalActAbility =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export interface LethalActProposal {
  kind: 'saving_throw' | 'ability_check';
  ability: LethalActAbility;
  dc: number;
  purpose: string;
}

export interface LethalActResolution {
  success: boolean;
  natural: number;
  modifier: number;
  total: number;
  dc: number;
  damage: number;
  vitals: VitalsWrite;
  engineCard: EngineResultCard;
}

/** 2014 default: Constitution for ingested poison, Dexterity otherwise, Hard DC 15. */
export function defaultLethalActProposal(text: string): LethalActProposal {
  const lower = text.toLowerCase();
  if (/\bpoison\b/.test(lower)) {
    return {
      kind: 'saving_throw',
      ability: 'constitution',
      dc: 15,
      purpose: 'Constitution saving throw',
    };
  }
  return {
    kind: 'saving_throw',
    ability: 'dexterity',
    dc: 15,
    purpose: 'Dexterity saving throw',
  };
}

const vitalsWriteFrom = (current: CharacterVitals): VitalsWrite => ({
  currentHitPoints: current.currentHitPoints,
  temporaryHitPoints: current.temporaryHitPoints,
  isConscious: current.isConscious,
  vitalState: current.vitalState,
  deathSavesSuccesses: current.deathSavesSuccesses,
  deathSavesFailures: current.deathSavesFailures,
});

/**
 * Resolve one confirmed lethal act. `natural` is the engine's d20 face (1–20).
 *
 * A failed save deals the character's current HP (plus any temporary HP), so
 * they drop to 0 and start dying — the normal unconscious and death-save
 * state, which `computeVitalsAfterDamage` already writes outside a fight.
 * They are never "dead" from this one roll: leftover damage is 0, so the
 * massive-damage instant-death rule does not fire.
 *
 * A successful save deals half the current HP, rounded down, at least 1.
 * At 1 current HP that minimum is 1, so they drop to 0 and start dying —
 * never dead from this one roll, the same as a failed save at higher HP.
 */

/** Half current HP, rounded down, at least 1. */
export function successDamage(currentHitPoints: number): number {
  if (currentHitPoints <= 0) return 0;
  return Math.max(1, Math.floor(currentHitPoints / 2));
}

/** Enough to reach exactly 0 HP, so the leftover is not massive damage. */
export function failDamage(
  vitals: Pick<CharacterVitals, 'currentHitPoints' | 'temporaryHitPoints'>,
): number {
  return Math.max(0, vitals.currentHitPoints + vitals.temporaryHitPoints);
}

export function resolveLethalAct(input: {
  proposal: LethalActProposal;
  abilityScore: number;
  vitals: CharacterVitals;
  natural: number;
}): LethalActResolution {
  const modifier = abilityModifier(input.abilityScore);
  const natural = Math.trunc(input.natural);
  const total = natural + modifier;
  const dc = input.proposal.dc;
  const success = total >= dc;
  const currentHp = input.vitals.currentHitPoints;
  const damage = success ? successDamage(currentHp) : failDamage(input.vitals);
  const vitals =
    damage > 0 ? computeVitalsAfterDamage(input.vitals, damage) : vitalsWriteFrom(input.vitals);

  const verdict = success ? 'SUCCESS' : 'FAIL';
  const numbers = `${total} vs DC ${dc}`;
  const engineCard: EngineResultCard = {
    kind: 'check',
    side: 'party',
    line: `${input.proposal.purpose}: ${numbers}, ${verdict}`,
    title: input.proposal.purpose,
    badge: {
      word: verdict,
      tone: success ? 'gold' : 'red',
      icon: success ? 'check' : 'alert',
    },
    detail: numbers,
    ...(damage > 0
      ? {
          effect: `Takes ${damage} damage.`,
          hp: {
            name: 'you',
            newHp: vitals.currentHitPoints,
            lost: damage,
            maxHp: input.vitals.maxHitPoints,
          },
        }
      : {}),
  };

  return { success, natural, modifier, total, dc, damage, vitals, engineCard };
}
