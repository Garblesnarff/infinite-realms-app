/**
 * The fixtures here are real content shapes taken from the production `campaign_chunks`
 * table, not invented ones. Three campaigns use three different conventions, and an early
 * parser scoped to only the first would have silently mis-read the second and found nothing
 * in the third — which is exactly the failure mode this file exists to prevent.
 */
import { describe, expect, test } from 'bun:test';

import { gradeCoverage, parseAuthoredStatBlock } from '../authored-stat-block-parser.js';
import { resolveMonsterAttackProfile } from '../monster-attack-profile.js';

/** the-eternal-feast: bold labels, space-separated, all on one line. */
const GLUTEN_GOLEM = `**Gluten Golem**

**HP:** 90 **AC:** 14 **Speed:** 30ft
**Abilities:**
*   *Rising Dough:* At start of turn, regains 10 HP and grows one size category (Max Huge).`;

/** abyssal-descent: single-asterisk italics, comma-separated, inside a bullet. */
const CHIROPTERAN_HULK = `**The Chiropteran Hulk**

*   *Visual:* A bat the size of a bear, face resembles a screaming man.
*   *HP:* 80, *AC:* 14, *Speed:* 10ft / 50ft Fly.
*   *Abilities:*
    *   **Echolocation:** Blindsight 120ft. Blind beyond that.`;

/** academy-of-arcane-gastronomy: a narrative bio filed as an NPC. No mechanics exist. */
const SUGAR_GOLEM = `17. **The Sugar Golem** (Construct) - A golem made of hardened sugar, capable of
unleashing devastating sugar-based attacks. **Voice:** A series of sweet, sticky
crackles. **Goal:** To protect the Sugar Queen. **Secret:** It is slowly dissolving.`;

describe('markup dialects', () => {
  test('reads bold-label, space-separated blocks (the-eternal-feast)', () => {
    const parsed = parseAuthoredStatBlock(GLUTEN_GOLEM);
    expect(parsed).toMatchObject({ maxHp: 90, armorClass: 14, speed: 30 });
    expect(gradeCoverage(parsed)).toBe('full');
  });

  test('reads italic-label, comma-separated, bulleted blocks (abyssal-descent)', () => {
    const parsed = parseAuthoredStatBlock(CHIROPTERAN_HULK);
    expect(parsed).toMatchObject({ maxHp: 80, armorClass: 14, speed: 10 });
    expect(gradeCoverage(parsed)).toBe('full');
  });

  test('a narrative bio with no authored mechanics yields nothing at all', () => {
    // Not a parser failure — no numbers were ever written for this campaign's creatures.
    // Yielding nothing is the correct, honest result; the audit reports it as a content gap.
    const parsed = parseAuthoredStatBlock(SUGAR_GOLEM);
    expect(parsed.parsedFields).toEqual([]);
    expect(parsed.unparsedLabels).toEqual([]);
    expect(gradeCoverage(parsed)).toBe('none');
  });
});

describe('strictness: a malformed block cannot yield a plausible-but-wrong stat', () => {
  test('prose containing numbers produces no stats', () => {
    const parsed = parseAuthoredStatBlock(
      'A terrifying creature, 90 pounds of dough, with 14 grasping arms and 30 teeth.',
    );
    expect(parsed.parsedFields).toEqual([]);
  });

  test('a present label with an unreadable value is reported, not guessed', () => {
    const parsed = parseAuthoredStatBlock('**HP:** lots **AC:** very high');
    expect(parsed.maxHp).toBeUndefined();
    expect(parsed.armorClass).toBeUndefined();
    expect(parsed.unparsedLabels).toEqual(['HP', 'AC']);
  });

  test('values outside a legal range are refused rather than clamped', () => {
    // A clamp would invent a number the author never wrote. Refusing surfaces the content bug.
    expect(parseAuthoredStatBlock('**AC:** 99').armorClass).toBeUndefined();
    expect(parseAuthoredStatBlock('**HP:** 0').maxHp).toBeUndefined();
    expect(parseAuthoredStatBlock('**AC:** 99').unparsedLabels).toEqual(['AC']);
  });

  test('hit dice are not mistaken for hit points', () => {
    expect(parseAuthoredStatBlock('**HP:** 12d8 + 36').maxHp).toBeUndefined();
    expect(parseAuthoredStatBlock('**HP:** 90 (12d8+36)').maxHp).toBe(90);
  });

  test('an embedded encounter table cannot contribute another creature’s numbers', () => {
    // Abyssal Descent's "The Thing Below" carries a d20 table inline behind a TAG marker.
    const parsed = parseAuthoredStatBlock(`**The Thing Below**

*   *HP:* 200, *AC:* 17, *Speed:* 20ft.

[TAG: ENCOUNTER_TABLE]
| d20 | Encounter |
| 1 | **Gloom Stalker** *HP:* 45, *AC:* 13 |`);
    expect(parsed).toMatchObject({ maxHp: 200, armorClass: 17 });
  });

  test('a standalone encounter table yields no creature at all', () => {
    expect(
      parseAuthoredStatBlock('[TAG: ENCOUNTER_TABLE]\n| 1 | *HP:* 45, *AC:* 13 |').parsedFields,
    ).toEqual([]);
  });
});

describe('per-field reporting', () => {
  test('a readable HP survives an unreadable AC', () => {
    const parsed = parseAuthoredStatBlock('**HP:** 20 **AC:** unknown **Speed:** 25ft');
    expect(parsed.maxHp).toBe(20);
    expect(parsed.speed).toBe(25);
    expect(parsed.armorClass).toBeUndefined();
    expect(parsed.unparsedLabels).toEqual(['AC']);
    expect(gradeCoverage(parsed)).toBe('partial');
  });

  test('HP alone grades as partial, HP and AC together as full', () => {
    expect(gradeCoverage(parseAuthoredStatBlock('**HP:** 150'))).toBe('partial');
    expect(gradeCoverage(parseAuthoredStatBlock('**HP:** 150 **AC:** 15'))).toBe('full');
  });
});

describe('combat fields beyond HP/AC/Speed', () => {
  test('an attack line yields bonus, dice and damage type together', () => {
    const parsed = parseAuthoredStatBlock(
      '**HP:** 90 **AC:** 14\n**Attack:** +7 to hit, 2d10+4 bludgeoning',
    );
    expect(parsed).toMatchObject({
      attackBonus: 7,
      damageDice: '2d10+4',
      damageType: 'bludgeoning',
    });
  });

  test('an attack bonus requires an explicit sign, so a descriptive attack yields no number', () => {
    const parsed = parseAuthoredStatBlock('**Attack:** slams with a rusty ladle');
    expect(parsed.attackBonus).toBeUndefined();
    expect(parsed.damageDice).toBeUndefined();
  });

  test('resistances, immunities and size are read when authored', () => {
    const parsed = parseAuthoredStatBlock(
      '**Size:** Large\n**Immunities:** poison, psychic\n**Resistances:** cold and fire',
    );
    expect(parsed).toMatchObject({
      size: 'large',
      damageImmunities: ['poison', 'psychic'],
      damageResistances: ['cold', 'fire'],
    });
  });

  test('an explicit "none" list is not read as a resistance', () => {
    expect(parseAuthoredStatBlock('**Resistances:** None').damageResistances).toBeUndefined();
  });
});

describe('authored attack name and range', () => {
  test('a named ranged attack keeps its name, range, and ranged flag', () => {
    const parsed = parseAuthoredStatBlock(
      '**HP:** 40 **AC:** 13\n**Attack (Ink Lash):** +5 to hit, range 60 ft, 2d8+2 piercing',
    );
    expect(parsed).toMatchObject({
      attackBonus: 5,
      attackName: 'Ink Lash',
      damageDice: '2d8+2',
      damageType: 'piercing',
    });
    expect(parsed.attackText).toContain('range 60 ft');

    const profile = resolveMonsterAttackProfile({
      authored: parsed,
      maxHp: 40,
      monsterName: 'Heckling Harpy',
    });
    expect(profile.source).toBe('authored');
    expect(profile.attacks[0]).toMatchObject({
      name: 'Ink Lash',
      attackBonus: 5,
      damageDice: '2d8',
      damageBonus: 2,
      damageType: 'piercing',
      normalRange: 60,
      ranged: true,
    });
  });

  test('a ranged attack with a long range keeps both distances', () => {
    const parsed = parseAuthoredStatBlock(
      '*Attack (Spit):* +4 to hit, range 30/120 ft, 1d8 poison',
    );
    expect(parsed.attackName).toBe('Spit');
    const profile = resolveMonsterAttackProfile({ authored: parsed, monsterName: 'Toad' });
    expect(profile.attacks[0]).toMatchObject({
      name: 'Spit',
      normalRange: 30,
      longRange: 120,
      ranged: true,
      damageType: 'poison',
    });
  });

  test('a plain melee block stays unnamed and melee 5 ft', () => {
    const parsed = parseAuthoredStatBlock(
      '**HP:** 90 **AC:** 14\n**Attack:** +7 to hit, 2d10+4 bludgeoning',
    );
    expect(parsed.attackName).toBeUndefined();
    expect(parsed.attackBonus).toBe(7);
    const profile = resolveMonsterAttackProfile({
      authored: parsed,
      monsterName: 'Gluten Golem',
    });
    expect(profile.attacks[0]).toMatchObject({
      name: 'strike',
      normalRange: 5,
      ranged: false,
      damageDice: '2d10',
      damageBonus: 4,
    });
    expect(profile.attacks[0].longRange).toBeUndefined();
  });

  test('reach is melee at the authored distance, not a ranged attack', () => {
    const parsed = parseAuthoredStatBlock('**Attack:** +3 to hit, reach 10 ft, 1d6 slashing');
    const profile = resolveMonsterAttackProfile({ authored: parsed, monsterName: 'Tendril' });
    expect(profile.attacks[0]).toMatchObject({
      name: 'strike',
      normalRange: 10,
      ranged: false,
    });
  });

  test('a parenthetical that is not a name does not drop the +N', () => {
    const empty = parseAuthoredStatBlock('**Attack ():** +5 to hit, 1d6 slashing');
    expect(empty.attackBonus).toBe(5);
    expect(empty.attackName).toBeUndefined();

    const dice = parseAuthoredStatBlock('**Attack (2d6):** +5 to hit, 1d4 piercing');
    expect(dice.attackBonus).toBe(5);
    expect(dice.attackName).toBeUndefined();
  });

  test('a name written before the +N is not accepted and does not invent a bonus', () => {
    // The value must still start with `+`. Loosening that to fit "Ink Lash, +5" would
    // also accept prose the author did not mean as a to-hit bonus.
    const parsed = parseAuthoredStatBlock('**Attack:** Ink Lash, +5 to hit, 1d6 slashing');
    expect(parsed.attackBonus).toBeUndefined();
    expect(parsed.attackName).toBeUndefined();
  });
});
