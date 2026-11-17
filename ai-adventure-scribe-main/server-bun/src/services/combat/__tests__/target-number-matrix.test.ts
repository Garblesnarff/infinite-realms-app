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
import {
  engineCardAriaLabel,
  engineCardMathText,
  hideTargetNumbers,
} from '../../../../../shared/engine-result-card';
import { repairNarration } from '../../dm/narration-outcome.js';
import { describeResolvedAttack, describeResolvedSpell } from '../attack-narration.js';
import { describeOutcome } from '../combat-check-outcome-text.js';
import { resolveDcCheck } from '../combat-check-rules.js';

import type { EngineResultCard } from '../../../../../shared/engine-result-card';

/**
 * #157 matrix: which surfaces show a target number, and whether they follow the setting.
 *
 * Covered, one or more rows each. "On" must show the number; "off" must never show it, and never
 * show a placeholder such as "vs AC ?".
 *  - Weapon attack, spell attack, spell save: roll dialog, engine line (card aria label and math
 *    text), the raw `card.line` after `hideTargetNumbers`, and the server narration.
 *  - Ability check (parley): roll dialog, the server engine line (`describeOutcome`, now in
 *    combat-check-outcome-text.ts), and the DM fact (wording pinned, not changed).
 *  - DM-facing narration repair for a roll that claimed a DC or AC (`repairNarration`).
 *  - NPC "Behind the Screen" summary: rows in src/services/ai/__tests__/npc-roll-handler.test.ts
 *    (client test; that module imports AIService, so it cannot load in this server suite).
 *  - Saving-throw dialog: no roll popup. Covered by SpellTargetSaveCard.test.tsx ("Save DC" is
 *    absent when off; "You do not roll" always shown). Saves are engine-rolled.
 *
 * NOT covered (listed, not changed):
 *  - DM-bound text, unchanged by the stop rule: `dmEngineLine` and `dmFact` (the non-parley fact
 *    restates the engine line) and the continuation prompt in npc-roll-handler.ts
 *    (`continueNarrativeWithNPCRolls`). The rows below pin the current DM wording only.
 *  - Passive Perception on a hide check ("vs passive Perception N"): the rule names AC and DC
 *    only, so it is out of this change. Filed as a follow-up.
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

/** The raw `card.line` of each card, as the legacy chip and saved messages keep it. */
function cardLines(
  action: { actor_id: string; action_type: string; target_ids: string[] },
  result: CombatEngineResult,
): Array<{ line: string; card: EngineResultCard }> {
  return formatCombatEngineParts(action, result, [], { targetHp: false }).flatMap((part) =>
    part.card ? [{ line: part.line, card: part.card }] : [],
  );
}

describe('target numbers: card.line (raw engine line, hidden at display)', () => {
  it('weapon attack: hideTargetNumbers removes the AC when off; the on text keeps it', () => {
    const lines = cardLines(attackAction, attackResult);
    expect(lines.length).toBeGreaterThan(0);
    for (const { line, card } of lines) {
      if (line.includes('vs AC')) {
        expect(hideTargetNumbers(line, card)).not.toMatch(TARGET_PATTERN);
      }
    }
    expect(lines.map((entry) => entry.line).join('\n')).toContain('vs AC 12');
  });

  it('spell save: hideTargetNumbers removes the DC when off; the on text keeps it', () => {
    const lines = cardLines(spellAction, saveResult);
    expect(lines.map((entry) => entry.line).join('\n')).toContain('vs DC 13');
    for (const { line, card } of lines) {
      expect(hideTargetNumbers(line, card)).not.toMatch(TARGET_PATTERN);
    }
  });
});

describe('target numbers: ability check engine line and DM fact (parley)', () => {
  const persuadeOutcome = (actorD20: number) =>
    resolveDcCheck({
      kind: 'persuade',
      actorProfile: { scores: { cha: 12 }, level: 1 },
      actorD20,
      dc: 15,
      opposedByLabel: 'DC 15',
      roll: () => 1,
    });

  it('engine line (success): shows DC when on, never when off', () => {
    const resolution = persuadeOutcome(18);
    const on = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers: true,
    });
    const off = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers: false,
    });
    expect(on.engineLine).toContain('vs DC 15');
    expect(off.engineLine).not.toMatch(TARGET_PATTERN);
    expect(off.engineLine).toContain('success');
  });

  it('engine line (failure): shows DC when on, never when off', () => {
    const resolution = persuadeOutcome(2);
    const on = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers: true,
    });
    const off = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers: false,
    });
    expect(on.engineLine).toContain('vs DC 15');
    expect(off.engineLine).not.toMatch(TARGET_PATTERN);
    expect(off.engineLine).toContain('failure');
  });

  it('DM fact (DM-bound, wording pinned, not changed): DC only when on', () => {
    const resolution = persuadeOutcome(18);
    const on = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers: true,
    });
    const off = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers: false,
    });
    expect(on.dmFact).toContain('against DC 15');
    expect(off.dmFact).not.toMatch(/DC \d/);
    expect(off.dmEngineLine).toBe(off.engineLine);
  });
});

describe('target numbers: DM-facing narration repair', () => {
  const saveOutcome = { success: false, total: 7, dc: 14, description: 'Dexterity save' };

  it('repair sentence: shows DC when on, never when off', () => {
    expect(repairNarration(saveOutcome, true)).toContain('vs DC 14');
    expect(repairNarration(saveOutcome, false)).toBe('The Dexterity save failed (7).');
    expect(repairNarration(saveOutcome, false)).not.toMatch(TARGET_PATTERN);
  });

  it('repair sentence (attack): shows AC when on, never when off', () => {
    const attackOutcome = { success: true, total: 18, ac: 15, description: 'longsword attack' };
    expect(repairNarration(attackOutcome, true)).toContain('vs AC 15');
    expect(repairNarration(attackOutcome, false)).not.toMatch(TARGET_PATTERN);
  });
});
