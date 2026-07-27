/**
 * Monsters attack with their own numbers.
 *
 * The instrumentation added in e23894a4 made the gap visible on its first run: every
 * DM-authored monster, up to and including a CR 10 Stone Golem with 178 hit points, attacked
 * at +2 for exactly 1 damage. The catalog had carried each creature's printed actions all
 * along and nothing had ever read them.
 *
 * These tests assert against the values *printed in monsters.json*, not merely against
 * "something other than the default". A profile that resolved to the wrong creature's numbers
 * would satisfy the weaker assertion perfectly, and a stat swap is invisible in play — the
 * fight simply feels off — which is the same property that let the original bug live for
 * sixteen playtests.
 */
import { describe, expect, test } from 'bun:test';

import monsterCatalog from '../../../../../src/data/srd/monsters.json' with { type: 'json' };
import {
  crBandForHitPoints,
  deriveAttackFromHitPoints,
  parseSrdActions,
  resolveMonsterAttackProfile,
  splitDamageDice,
} from '../monster-attack-profile.js';

type CatalogEntry = {
  id: string;
  name: string;
  hitPoints?: number;
  actions?: Array<Record<string, unknown>>;
};
const catalog = monsterCatalog as unknown as CatalogEntry[];
const entry = (id: string): CatalogEntry => {
  const found = catalog.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`fixture drift: ${id} is no longer in the catalog`);
  return found;
};

describe('splitDamageDice', () => {
  test('separates the dice from the flat addend the SRD folds into them', () => {
    // Load-bearing, not cosmetic: `rollDamageDice` accepts `NdN` only and throws on anything
    // else, so an unsplit `3d8+6` would fail the attack outright. And it must be a split
    // rather than a strip, because a crit doubles the dice and adds the modifier once.
    expect(splitDamageDice('3d8+6')).toEqual({ dice: '3d8', bonus: 6 });
    expect(splitDamageDice('2d6')).toEqual({ dice: '2d6', bonus: 0 });
    expect(splitDamageDice('1d10-1')).toEqual({ dice: '1d10', bonus: -1 });
    expect(splitDamageDice(' 3D8 + 6 ')).toEqual({ dice: '3d8', bonus: 6 });
  });

  test('a flat damage number becomes dice the roller accepts', () => {
    // `1d1 + 3` is exactly 4, not an approximation of it.
    expect(splitDamageDice('4')).toEqual({ dice: '1d1', bonus: 3 });
  });

  test('nothing readable yields null rather than a guess', () => {
    expect(splitDamageDice('')).toBeNull();
    expect(splitDamageDice(undefined)).toBeNull();
    expect(splitDamageDice('a lot')).toBeNull();
  });
});

describe('parseSrdActions classification', () => {
  test("the Stone Golem's Slam is read at its printed +10 and 3d8+6", () => {
    const parsed = parseSrdActions(entry('srd:stone-golem').actions as never);
    expect(parsed.attacks).toHaveLength(1);
    expect(parsed.attacks[0]).toMatchObject({
      name: 'Slam',
      attackBonus: 10,
      damageDice: '3d8',
      damageBonus: 6,
      damageType: 'bludgeoning',
      normalRange: 5,
      ranged: false,
    });
  });

  test('Multiattack is a directive, never an attack', () => {
    const parsed = parseSrdActions(entry('srd:stone-golem').actions as never);
    expect(parsed.attacks.map((attack) => attack.name)).not.toContain('Multiattack');
    // It is still reported, because a golem that makes two slams and is modelled as making
    // one is a known shortfall rather than an absent feature.
    expect(parsed.multiattackDesc).toBe('The golem makes two slam attacks.');
  });

  test('a saving-throw ability is excluded and named, not approximated as a weapon', () => {
    // The golem's Slow is a DC 17 Wisdom save. The pipeline compares d20 + bonus against AC
    // and has no saving-throw path, so rendering it as a swing would invent a number.
    const parsed = parseSrdActions(entry('srd:stone-golem').actions as never);
    expect(parsed.unsupported).toContain('Slow (saving-throw ability)');
  });

  test('a monster with melee and ranged options yields both, with their real geometry', () => {
    const parsed = parseSrdActions(entry('srd:goblin').actions as never);
    expect(parsed.attacks).toEqual([
      expect.objectContaining({
        name: 'Scimitar',
        attackBonus: 4,
        damageDice: '1d6',
        damageBonus: 2,
        damageType: 'slashing',
        normalRange: 5,
        ranged: false,
      }),
      expect.objectContaining({
        name: 'Shortbow',
        attackBonus: 4,
        damageDice: '1d6',
        damageBonus: 2,
        damageType: 'piercing',
        normalRange: 80,
        longRange: 320,
        ranged: true,
      }),
    ]);
  });

  test('the whole catalog classifies without a Multiattack leaking into the attack set', () => {
    // The structural flag and a `/^multiattack/i` name agree on all 148 entries; this pins
    // that the parser keys on the flag and that the two never diverge unnoticed.
    let attacks = 0;
    let multiattackFlagged = 0;
    for (const candidate of catalog) {
      const parsed = parseSrdActions(candidate.actions as never);
      attacks += parsed.attacks.length;
      if (parsed.multiattackDesc !== undefined) multiattackFlagged += 1;
      for (const attack of parsed.attacks) {
        expect(attack.name).not.toMatch(/^multiattack/i);
        expect(attack.damageDice).toMatch(/^\d+d\d+$/);
        expect(Number.isFinite(attack.attackBonus)).toBe(true);
      }
    }
    expect(attacks).toBe(514);
    expect(multiattackFlagged).toBe(148);
  });
});

describe('CR derivation (DMG p.274 monster statistics by challenge rating)', () => {
  test('hit points place a creature in its published CR band', () => {
    expect(crBandForHitPoints(6).cr).toBe('0');
    expect(crBandForHitPoints(20).cr).toBe('1/8');
    expect(crBandForHitPoints(90).cr).toBe('2');
    expect(crBandForHitPoints(178).cr).toBe('8');
    expect(crBandForHitPoints(5000).cr).toBe('30');
  });

  test('a derived attack spends its whole CR damage budget on one attack', () => {
    // The engine resolves one attack per action, so splitting the round's budget across
    // notional multiattacks would leave the creature hitting for a fraction of what its hit
    // points imply — the bug being fixed, in a smaller size.
    const attack = deriveAttackFromHitPoints(90);
    expect(attack.attackBonus).toBe(3); // CR 2 attack bonus
    expect(attack.damageDice).toBe('5d6'); // ~17.5 average against a 17 dmg/round budget
    expect(attack.damageDice).toMatch(/^\d+d\d+$/);
  });

  test('a bigger creature derives a bigger attack', () => {
    const small = deriveAttackFromHitPoints(20);
    const large = deriveAttackFromHitPoints(300);
    expect(large.attackBonus).toBeGreaterThan(small.attackBonus);
    expect(Number(/^(\d+)d/.exec(large.damageDice)![1])).toBeGreaterThan(
      Number(/^(\d+)d/.exec(small.damageDice)![1]),
    );
  });
});

describe('precedence: authored -> catalog -> derived -> generic', () => {
  const catalogParse = parseSrdActions(entry('srd:stone-golem').actions as never);
  const authored = { attackBonus: 7, damageDice: '2d10+4', damageType: 'fire' };

  test('an authored attack outranks the catalog entry for the same creature', () => {
    const profile = resolveMonsterAttackProfile({
      authored,
      catalog: catalogParse,
      maxHp: 178,
      monsterName: 'Stone Golem',
    });
    expect(profile.source).toBe('authored');
    expect(profile.attacks[0]).toMatchObject({
      attackBonus: 7,
      damageDice: '2d10',
      damageBonus: 4,
      damageType: 'fire',
    });
  });

  test('the catalog outranks derivation when no attack was authored', () => {
    const profile = resolveMonsterAttackProfile({
      authored: { attackBonus: undefined, damageDice: undefined },
      catalog: catalogParse,
      maxHp: 178,
      monsterName: 'Stone Golem',
    });
    expect(profile.source).toBe('catalog');
    expect(profile.attacks[0]).toMatchObject({ name: 'Slam', attackBonus: 10, damageBonus: 6 });
  });

  test('derivation catches a creature with hit points and nothing else', () => {
    // Every campaign bible in the product today: HP and AC authored, abilities as prose.
    const profile = resolveMonsterAttackProfile({
      authored: null,
      catalog: null,
      maxHp: 90,
      monsterName: 'Gluten Golem',
    });
    expect(profile.source).toBe('derived');
    expect(profile.attacks).toHaveLength(1);
    // The inference is published alongside the result so a reader can check the arithmetic.
    expect(profile.derivation).toEqual({
      fromMaxHp: 90,
      challengeRating: '2',
      damagePerRound: 17,
    });
  });

  test('an authored attack bonus with no dice is not enough, and falls through', () => {
    // Half an attack line is a content bug, not an attack. Falling through to a rung that
    // can produce a whole attack beats inventing the missing half.
    const profile = resolveMonsterAttackProfile({
      authored: { attackBonus: 7 },
      catalog: null,
      maxHp: 90,
      monsterName: 'Half Stat Fiend',
    });
    expect(profile.source).toBe('derived');
  });

  test('nothing at all resolves to generic, with no attacks to swing', () => {
    const profile = resolveMonsterAttackProfile({ authored: null, catalog: null, maxHp: null });
    expect(profile.source).toBe('generic');
    expect(profile.attacks).toEqual([]);
  });

  test('a catalog profile carries its unexpressed Multiattack forward', () => {
    const profile = resolveMonsterAttackProfile({ catalog: catalogParse, maxHp: 178 });
    expect(profile.multiattack).toEqual({
      desc: 'The golem makes two slam attacks.',
      expressible: false,
    });
  });
});
