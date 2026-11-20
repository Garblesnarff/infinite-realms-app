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
 * The rule: with "Show target numbers" off, the player never reads "vs AC N" or "vs DC N". The
 * hiding happens in the layer that shows the text to the player (client display). Server text
 * that feeds the DM stays as on main, so the DM's input does not change; a row for such text
 * asserts it is unchanged.
 *
 * Covered, with a row for each:
 *  - Weapon attack, spell attack, spell save: roll dialog, engine line (card aria label and math
 *    text), raw `card.line` after `hideTargetNumbers`, and server narration (weapon narration has
 *    no number at all).
 *  - Ability check, player display: hidden in the client layer (`EngineLine` and the tracker's
 *    `combatLogLines`), with `useShowTargetNumbers`. Rows are in
 *    src/features/game-session/components/chat/message-list/__tests__/EngineLine.target-numbers.test.tsx
 *    and src/utils/__tests__/combat-log-lines.target-numbers.test.ts. This server suite cannot load
 *    React components.
 *  - Ability check, DM input: the server engine line keeps the DC and `dmEngineLine` drops it when
 *    off, both as on main. The DM fact keeps its wording. Rows pin this, they do not change it.
 *  - Saving-throw dialog: no roll popup. Covered by SpellTargetSaveCard.test.tsx ("Save DC" absent
 *    when off; "You do not roll" always shown).
 *  - NPC "Behind the Screen" summary: rows in
 *    src/services/ai/__tests__/npc-roll-handler.target-numbers.test.ts (client; this server suite
 *    cannot load AIService).
 *
 * NOT covered (listed, not changed):
 *  - DM-facing narration repair (`repairNarration`, narration-outcome.ts): its text is as on main,
 *    so the repaired sentence shows "vs DC N" / "vs AC N" even when the setting is off. The
 *    repaired sentence is saved and can re-enter DM history. The rows below pin the text as on main.
 *  - DM-bound text, unchanged by the stop rule: the server `engineLine`
 *    (combat-resolution-step.ts:1519 sends it as `authoritativeCheckResult.engineLine`), the
 *    non-parley `dmFact`, `dmEngineLine` for non-parley checks, and the NPC continuation prompt.
 *    The "N HP" wording stays.
 *  - Passive Perception on a hide check ("vs passive Perception N"): the rule names AC and DC only.
 *    Follow-up.
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

const persuadeOutcome = (actorD20: number) =>
  resolveDcCheck({
    kind: 'persuade',
    actorProfile: { scores: { cha: 12 }, level: 1 },
    actorD20,
    dc: 15,
    opposedByLabel: 'DC 15',
    roll: () => 1,
  });

function parleyOutcome(actorD20: number, showTargetNumbers: boolean) {
  return describeOutcome({
    resolution: persuadeOutcome(actorD20),
    consequence: '',
    actorLabel: 'Rook',
    targetLabel: 'Goblin',
    parleyDc: 15,
    showTargetNumbers,
  });
}

describe('target numbers: ability check, DM input (server text, unchanged from main)', () => {
  it('server engine line keeps the DC whatever the setting (it is the DM input)', () => {
    for (const d20 of [18, 2]) {
      expect(parleyOutcome(d20, true).engineLine).toContain('vs DC 15');
      expect(parleyOutcome(d20, false).engineLine).toContain('vs DC 15');
    }
  });

  it('dmEngineLine drops the DC when off and keeps it when on, as on main', () => {
    expect(parleyOutcome(18, true).dmEngineLine).toContain('vs DC 15');
    expect(parleyOutcome(18, false).dmEngineLine).not.toMatch(/DC \d/);
  });

  it('DM fact (DM-bound, wording pinned, not changed): DC only when on', () => {
    expect(parleyOutcome(18, true).dmFact).toContain('against DC 15');
    expect(parleyOutcome(18, false).dmFact).not.toMatch(/DC \d/);
  });
});

describe('target numbers: DM-facing narration repair (text as on main, listed, not changed)', () => {
  const saveOutcome = { success: false, total: 7, dc: 14, description: 'Dexterity save' };
  const attackOutcome = { success: true, total: 18, ac: 15, description: 'longsword attack' };

  it('repair sentence shows the DC even when the setting is off (listed gap)', () => {
    expect(repairNarration(saveOutcome)).toBe('The Dexterity save failed (7 vs DC 14).');
  });

  it('repair sentence shows the AC (listed gap)', () => {
    expect(repairNarration(attackOutcome)).toBe('The longsword attack succeeded (18 vs AC 15).');
  });
});
