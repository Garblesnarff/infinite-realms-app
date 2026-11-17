import { describe, expect, it } from 'bun:test';

import {
  formatCombatEngineParts,
  type CombatEngineResult,
} from '../../../../../shared/combat-outcome-transcript';
import {
  describeAttackRoll,
  describeCheckRoll,
  type AttackRollDescriptionSpec,
} from '../../../../../shared/describe-attack-roll';
import { engineCardAriaLabel, engineCardMathText } from '../../../../../shared/engine-result-card';
import { describeResolvedAttack, describeResolvedSpell } from '../attack-narration.js';

import type { EngineResultCard } from '../../../../../shared/engine-result-card';

/**
 * #157 matrix: which surfaces show a target number, and whether they follow the setting.
 *
 * Covered: weapon attack, spell attack and spell saving throw on the engine line (card aria label
 * and math text) and the server narration; ability check on the roll dialog. "On" must show the
 * number; "off" must never show it, and never show a placeholder such as "vs AC ?".
 *
 * NOT covered (do not read the green run as proof of these):
 *  - No saving-throw dialog row. Saves are engine-rolled; no save popup exists.
 *  - No server ability-check narration row. `describeOutcome` in combat-check-service.ts is not
 *    exported, and importing that module pulls in the database chain.
 *  - Unverified DM-bound text: `dmFact` and the raw engine card line (`card.line`:
 *    shared/combat-outcome-transcript.ts:281, shared/combat-spell-transcript.ts:144 and :170), and
 *    src/services/ai/npc-roll-handler.ts:87-88. Not traced to the DM prompt.
 *  - Weapon server narration (`describeResolvedAttack`) carries no target number at all and takes
 *    no setting, so its "on" case asserts the sentence as produced, not a number.
 *
 * Enemy HP: the DM-bound "N HP" wording in spell narration is kept by decision (strategist, PR #1590).
 */

const TARGET_AC = 12;
const SAVE_DC = 13;

const attackSpec: AttackRollDescriptionSpec = {
  actorLabel: 'Rook',
  weaponName: 'Longsword',
  targetLabel: 'Goblin',
  attackBonus: 5,
  targetAc: TARGET_AC,
  advantage: false,
  disadvantage: false,
};

const attackResult: CombatEngineResult = {
  actorName: 'Rook',
  targetName: 'Goblin',
  d20: 12,
  attackBonus: 5,
  totalAttackRoll: 17,
  targetAC: TARGET_AC,
  baseAc: TARGET_AC,
  coverBonus: 0,
  hit: true,
  finalDamage: 4,
  damageType: 'slashing',
  targetNewHp: 3,
  targetIsConscious: true,
  targetIsDead: false,
};

const spellAttackResult: CombatEngineResult = {
  ...attackResult,
  spellName: 'Fire Bolt',
};

const saveResult: CombatEngineResult = {
  actorName: 'Rook',
  targetName: 'Goblin',
  spellName: 'Acid Splash',
  saveAbility: 'dexterity',
  saveRoll: 9,
  saveDC: SAVE_DC,
  saved: false,
  finalDamage: 4,
  damageType: 'acid',
  targetNewHp: 3,
  targetIsConscious: true,
  targetIsDead: false,
};

/** Every card-producing surface, for one engine result, as the player reads it. */
function engineSurfaces(
  action: { actor_id: string; action_type: string; target_ids: string[] },
  result: CombatEngineResult,
  show: boolean,
): string[] {
  const parts = formatCombatEngineParts(action, result, [], { targetHp: false });
  return parts.flatMap((part) => {
    const card: EngineResultCard | undefined = part.card;
    if (!card) return [];
    const math = card.math ? engineCardMathText(card.math, show) : '';
    return [engineCardAriaLabel(card, show), math];
  });
}

const attackAction = { actor_id: 'pc-rook', action_type: 'attack', target_ids: ['goblin-1'] };
const spellAction = { actor_id: 'pc-rook', action_type: 'cast_spell', target_ids: ['goblin-1'] };

const TARGET_PATTERN = /vs (AC|DC)\b|AC \?|\bAC\b|\bDC\b/;

describe('target numbers: attack', () => {
  it('roll dialog: shows AC when on, never when off', () => {
    expect(describeAttackRoll(attackSpec, true)).toContain('vs AC 12');
    expect(describeAttackRoll(attackSpec, false)).not.toMatch(TARGET_PATTERN);
  });

  it('engine line (weapon): shows AC when on, never when off', () => {
    const on = engineSurfaces(attackAction, attackResult, true).join('\n');
    const off = engineSurfaces(attackAction, attackResult, false).join('\n');
    expect(on).toContain('vs AC 12');
    expect(off).not.toMatch(TARGET_PATTERN);
  });

  it('engine line (spell attack): shows AC when on, never when off', () => {
    const on = engineSurfaces(spellAction, spellAttackResult, true).join('\n');
    const off = engineSurfaces(spellAction, spellAttackResult, false).join('\n');
    expect(on).toContain('vs AC 12');
    expect(off).not.toMatch(TARGET_PATTERN);
  });

  it('server narration (weapon): no target number on or off; the on case asserts the sentence as produced', () => {
    const outcome = {
      hit: true,
      finalDamage: 4,
      targetNewHp: 3,
      targetIsConscious: true,
    };
    // describeResolvedAttack takes no setting and prints no AC, so "on" and "off" are the same.
    const on = describeResolvedAttack('Rook', 'Goblin', outcome, 'Longsword');
    expect(on).toBe(
      'Rook attacked Goblin with its Longsword: HIT for 4 damage. Goblin is now at 3 HP. Narrate this outcome; it already happened.',
    );
    expect(on).not.toMatch(TARGET_PATTERN);
    expect(describeResolvedAttack('Rook', 'Goblin', outcome, 'Longsword')).toBe(on);
  });

  it('server narration (spell attack): shows AC when on, never when off', () => {
    const outcome = {
      d20: 12,
      attackBonus: 5,
      totalAttackRoll: 17,
      targetAC: TARGET_AC,
      hit: true,
      finalDamage: 4,
      targetNewHp: 3,
      targetIsConscious: true,
    };
    expect(describeResolvedSpell('Rook', 'Goblin', 'Fire Bolt', outcome, true)).toContain(
      'vs AC 12',
    );
    expect(describeResolvedSpell('Rook', 'Goblin', 'Fire Bolt', outcome, false)).not.toMatch(
      TARGET_PATTERN,
    );
  });
});

describe('target numbers: ability check', () => {
  const hideSpec = {
    checkLabel: 'Hide',
    checkModifier: 5,
    opposedByLabel: 'passive Perception 13',
  };
  const parleySpec = {
    checkLabel: 'Persuasion',
    checkModifier: 3,
    targetLabel: 'Goblin',
    opposedByLabel: 'DC 15',
  };

  it('roll dialog: shows the DC or passive score when on, never when off', () => {
    expect(describeCheckRoll(hideSpec, true)).toContain('vs passive Perception 13');
    expect(describeCheckRoll(parleySpec, true)).toContain('vs DC 15');
    expect(describeCheckRoll(hideSpec, false)).toBe('Hide — 1d20+5');
    expect(describeCheckRoll(parleySpec, false)).toBe('Persuasion vs Goblin — 1d20+3');
  });
});

describe('target numbers: saving throw (spell save)', () => {
  it('engine line: shows DC when on, never when off', () => {
    const on = engineSurfaces(spellAction, saveResult, true).join('\n');
    const off = engineSurfaces(spellAction, saveResult, false).join('\n');
    expect(on).toContain('vs DC 13');
    expect(off).not.toMatch(TARGET_PATTERN);
  });

  it('server narration: shows DC when on, never when off', () => {
    const outcome = {
      saveAbility: 'dexterity',
      saveRoll: 9,
      saveDC: SAVE_DC,
      saved: false,
      finalDamage: 4,
      targetNewHp: 3,
      targetIsConscious: true,
    };
    expect(describeResolvedSpell('Rook', 'Goblin', 'Acid Splash', outcome, true)).toContain(
      'vs DC 13',
    );
    expect(describeResolvedSpell('Rook', 'Goblin', 'Acid Splash', outcome, false)).not.toMatch(
      TARGET_PATTERN,
    );
  });
});
