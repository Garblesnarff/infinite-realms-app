/**
 * The SRD rules for the four mid-combat checks, tested against the rulebook rather than a fixture.
 *
 * No database and no encounter: these tests pin the contest maths and the DC logic that
 * `combat-check-service` depends on, so a wrong modifier is caught here rather than in a fight.
 */
import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_PARLEY_DC,
  SHOVE_PUSH_FEET,
  checkModifier,
  parleyDcFor,
  passivePerception,
  resolveContestedCheck,
  resolveDcCheck,
  resolveEscapeCheck,
  type CheckActorProfile,
} from '../combat-check-rules.js';

/** A die that returns `faces` in order, so a test pins both the player's and the target's die. */
const faces = (...values: number[]) => {
  let index = 0;
  return () => values[index++ % values.length];
};

const profile = (scores: Partial<CheckActorProfile['scores']>, level = 1): CheckActorProfile => ({
  scores,
  level,
});

describe('SRD contested checks: shove and grapple', () => {
  it('resolves a shove as Athletics against the higher of the target Athletics/Acrobatics', () => {
    // Player STR 16 (+3), nat 11 => 14. Goblin STR 8 (-1), Athletics chosen over a -1 Dexterity
    // tie, nat 3 => 2. Player wins.
    const resolution = resolveContestedCheck({
      kind: 'shove',
      actorProfile: profile({ str: 16 }),
      actorD20: 11,
      targetProfile: profile({ str: 8, dex: 8 }),
      roll: faces(3),
    });

    expect(resolution.actor.total).toBe(14);
    expect(resolution.target?.total).toBe(2);
    expect(resolution.success).toBe(true);
    expect(resolution.line).toBe('Shove: 14 (nat 11+3) vs Athletics 2 — success');
  });

  it('uses the target Acrobatics when it is the higher of the two', () => {
    // A goblin with strong Dexterity and weak Strength picks Acrobatics (SRD: the target chooses).
    // DEX 18 is +4, so a natural 20 contests as 24 against the player's 5.
    const resolution = resolveContestedCheck({
      kind: 'grapple',
      actorProfile: profile({ str: 10 }),
      actorD20: 5,
      targetProfile: profile({ str: 8, dex: 18 }),
      roll: faces(20),
    });

    expect(resolution.target?.total).toBe(24);
    expect(resolution.success).toBe(false);
    expect(resolution.line).toContain('vs Acrobatics 24 — failure');
  });

  it('fails the check when the target total ties or beats the player', () => {
    const resolution = resolveContestedCheck({
      kind: 'shove',
      actorProfile: profile({ str: 10 }),
      actorD20: 10,
      targetProfile: profile({ str: 10, dex: 10 }),
      roll: faces(10),
    });

    expect(resolution.success).toBe(false);
    expect(resolution.opposedBy).toBe(10);
  });

  it('adds proficiency when the sheet grants the skill', () => {
    const plain = checkModifier(profile({ str: 16 }, 5), {
      kind: 'shove',
      ability: 'str',
      skill: 'Athletics',
      label: 'Shove',
      contested: true,
    });
    const proficient = checkModifier(
      profile({ str: 16 }, 5),
      {
        kind: 'shove',
        ability: 'str',
        skill: 'Athletics',
        label: 'Shove',
        contested: true,
      },
      true,
    );

    expect(proficient - plain).toBe(3);
  });
});

describe('SRD DC checks: hide and parley', () => {
  it('measures a hide against the passive Perception it was given', () => {
    const resolution = resolveDcCheck({
      kind: 'hide',
      actorProfile: profile({ dex: 18 }),
      actorD20: 12,
      dc: 13,
      opposedByLabel: 'passive Perception 13',
      roll: faces(1),
    });

    // DEX 18 is +4, so 12 + 4 = 16 beats 13.
    expect(resolution.actor.total).toBe(16);
    expect(resolution.success).toBe(true);
    expect(resolution.target).toBeNull();
    expect(resolution.line).toBe('Hide: 16 (nat 12+4) vs passive Perception 13 — success');
  });

  it('fails a hide under the passive Perception', () => {
    const resolution = resolveDcCheck({
      kind: 'hide',
      actorProfile: profile({ dex: 10 }),
      actorD20: 9,
      dc: 13,
      opposedByLabel: 'passive Perception 13',
      roll: faces(1),
    });

    expect(resolution.success).toBe(false);
  });

  it('rolls the engine die when the popup supplied none', () => {
    const resolution = resolveContestedCheck({
      kind: 'shove',
      actorProfile: profile({ str: 10 }),
      targetProfile: profile({ str: 10 }),
      roll: faces(17, 2),
    });

    expect(resolution.actor.d20).toBe(17);
    expect(resolution.target?.d20).toBe(2);
  });
});

describe('passive Perception', () => {
  it('is 10 plus the Wisdom modifier', () => {
    expect(passivePerception(profile({ wis: 14 }))).toBe(12);
    expect(passivePerception(profile({ wis: 8 }))).toBe(9);
  });

  it('uses an authored value from the stat block instead of recomputing it', () => {
    expect(passivePerception(profile({ wis: 10 }), 14)).toBe(14);
  });
});

describe('parley DC from disposition', () => {
  it('defaults to 15 when the stat block names no DC and no disposition', () => {
    expect(parleyDcFor(null)).toEqual({ dc: DEFAULT_PARLEY_DC, source: 'default' });
    expect(parleyDcFor(undefined)).toEqual({ dc: DEFAULT_PARLEY_DC, source: 'default' });
    expect(parleyDcFor('curious')).toEqual({ dc: DEFAULT_PARLEY_DC, source: 'default' });
  });

  it('uses an authored parleyDc verbatim', () => {
    expect(parleyDcFor('hostile', 20)).toEqual({ dc: 20, source: 'authored' });
  });

  it('reads the disposition when the bible classifies it', () => {
    expect(parleyDcFor('ally')).toEqual({ dc: 10, source: 'disposition' });
    expect(parleyDcFor('neutral')).toEqual({ dc: 12, source: 'disposition' });
    expect(parleyDcFor('hostile')).toEqual({ dc: 18, source: 'disposition' });
  });
});

describe('the shove push distance', () => {
  it('is the SRD 5 feet', () => {
    expect(SHOVE_PUSH_FEET).toBe(5);
  });
});

describe('escaping a grapple (SRD 5.1, PB 195)', () => {
  const escape = (
    actor: CheckActorProfile,
    grappler: CheckActorProfile,
    d20: number,
    grapplerD20: number,
    proficiency: { athletics?: boolean; acrobatics?: boolean } = {},
  ) =>
    resolveEscapeCheck({
      actorProfile: actor,
      athleticsProficient: proficiency.athletics ?? false,
      acrobaticsProficient: proficiency.acrobatics ?? false,
      actorD20: d20,
      grapplerProfile: grappler,
      roll: faces(grapplerD20),
    });

  it("uses the better of the escaper's Athletics and Acrobatics", () => {
    // STR 8 (-1) against DEX 16 (+3): Acrobatics is the better skill.
    const resolution = escape(profile({ str: 8, dex: 16 }), profile({ str: 10 }), 10, 5);

    expect(resolution.actor.modifier).toBe(3);
    expect(resolution.line).toBe('Escape: 13 (nat 10+3) vs Athletics 5 — success');
  });

  it('adds proficiency only to the skill the sheet names', () => {
    // Level 1 proficiency is +2. STR 14 (+2) proficient in Athletics is +4; DEX 16 (+3) with no
    // Acrobatics proficiency stays +3, so the Athletics total wins.
    const resolution = escape(profile({ str: 14, dex: 16 }), profile({ str: 10 }), 10, 1, {
      athletics: true,
    });

    expect(resolution.actor.modifier).toBe(4);
  });

  it("tests against the grappler's Strength only; its Dexterity does not count", () => {
    // The grappler has a high DEX and a low STR. The grappler does not get to pick Acrobatics.
    const resolution = escape(profile({ str: 10 }), profile({ str: 8, dex: 20 }), 10, 10);

    expect(resolution.target?.modifier).toBe(-1);
    expect(resolution.opposedBy).toBe(9);
    expect(resolution.success).toBe(true);
  });

  it('a tie leaves the grapple in place', () => {
    const resolution = escape(profile({ str: 10 }), profile({ str: 10 }), 12, 12);

    expect(resolution.success).toBe(false);
    expect(resolution.line).toBe('Escape: 12 (nat 12+0) vs Athletics 12 — failure');
  });
});
