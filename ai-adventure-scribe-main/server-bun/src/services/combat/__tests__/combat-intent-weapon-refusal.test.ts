import { describe, expect, mock, test } from 'bun:test';

const stubLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  debug: mock(() => {}),
  error: mock(() => {}),
};
mock.module('../../../lib/logger.js', () => ({
  logger: stubLogger,
  combatLogger: stubLogger,
  spellLogger: stubLogger,
  progressionLogger: stubLogger,
}));
mock.module('../../../../../db/client', () => ({ db: {} }));

const { refuseUngroundedPlayerWeapon } = await import('../combat-intent-service.js');
const { groundRequestedWeapon } = await import('../weapon-grounding.js');
const { BusinessLogicError } = await import('../../../lib/errors.js');

import type { WeaponRuleProfile } from '../combat-rules.js';

/**
 * RG-014 (#260): the refusal decision that lives at the proposeCombatAttack and
 * executeCombatIntent call sites of combat-intent-service.ts, now shared through
 * refuseUngroundedPlayerWeapon. Both sites delegate to it, so pinning the helper
 * with real groundRequestedWeapon outputs pins both paths.
 *
 * Fixture shapes follow weapon-grounding.test.ts (the real WeaponRuleProfile
 * producer contract): id, name, damageDice, damageType, normalRange, magicBonus,
 * finesse, ranged, proficient.
 */
const weapon = (over: Partial<WeaponRuleProfile>): WeaponRuleProfile => ({
  id: 'id',
  name: 'Weapon',
  damageDice: '1d6',
  damageType: 'slashing',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
  ...over,
});

const GREATAXE = weapon({ id: 'inv-greataxe', name: 'Greataxe', damageDice: '1d12' });
const HANDAXE = weapon({ id: 'inv-handaxe', name: 'Handaxe' });
const SHORTSWORD = weapon({ id: 'inv-shortsword', name: 'Shortsword', finesse: true });

type RefusalError = InstanceType<typeof BusinessLogicError>;

/** Calls fn, expecting the weapon refusal; fails the test if nothing is thrown. */
function expectRefusal(fn: () => void): RefusalError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BusinessLogicError);
    return err as RefusalError;
  }
  throw new Error('expected refuseUngroundedPlayerWeapon to throw');
}

describe('refuseUngroundedPlayerWeapon (#260 / RG-014)', () => {
  test('a player naming a real weapon they do not own is refused with weapon_not_on_sheet', () => {
    // RG-014 repro: "I swing my longsword" with only Greataxe + Handaxe equipped.
    const grounding = groundRequestedWeapon('longsword', [GREATAXE, HANDAXE], [GREATAXE, HANDAXE]);
    expect(grounding.grounded).toBe(false);
    expect(grounding.notEquipped).toBe(false);

    const err = expectRefusal(() => refuseUngroundedPlayerWeapon(grounding, 'player'));
    expect(err.code).toBe('BUSINESS_LOGIC_ERROR');
    expect(err.details).toMatchObject({
      reason: 'weapon_not_on_sheet',
      requestedWeaponId: 'longsword',
    });
    // Exactly one error line: the refusal text appears once, not doubled.
    expect(err.message).toBe(
      'Weapon not on character sheet: longsword is not on your character sheet — choose an equipped weapon',
    );
    expect(err.message.split('Weapon not on character sheet').length - 1).toBe(1);
  });

  test('a DM-sourced intent naming an unowned weapon still substitutes, never refuses', () => {
    const grounding = groundRequestedWeapon('longsword', [GREATAXE, HANDAXE], [GREATAXE, HANDAXE]);
    expect(grounding.grounded).toBe(false);
    expect(() => refuseUngroundedPlayerWeapon(grounding, 'dm')).not.toThrow();
  });

  test('a player naming a carried-but-unequipped weapon is refused with weapon_not_equipped', () => {
    const grounding = groundRequestedWeapon('handaxe', [GREATAXE], [GREATAXE, HANDAXE]);
    expect(grounding.grounded).toBe(false);
    expect(grounding.notEquipped).toBe(true);

    const err = expectRefusal(() => refuseUngroundedPlayerWeapon(grounding, 'player'));
    expect(err.details).toMatchObject({
      reason: 'weapon_not_equipped',
      requestedWeaponId: 'handaxe',
    });
    expect(err.message).toBe(
      'Weapon not equipped: handaxe is not equipped — equip it before attacking, or choose an equipped weapon',
    );
    expect(err.message.split('Weapon not equipped').length - 1).toBe(1);
  });

  test.each(['sword', 'axe'])(
    'a loose phrase the catalog cannot resolve ("%s") is NOT newly refused',
    (phrase) => {
      const grounding = groundRequestedWeapon(phrase, [SHORTSWORD], [SHORTSWORD]);
      // Sanity: the phrase really is ungrounded, so this exercises the refusal gate.
      expect(grounding.grounded).toBe(false);
      expect(grounding.notEquipped).toBe(false);
      expect(() => refuseUngroundedPlayerWeapon(grounding, 'player')).not.toThrow();
    },
  );

  test.each([
    ['Sun Blade', 'magic-item name resolving through findMagicBaseWeapon'],
    ['123e4567-e89b-12d3-a456-426614174000', 'dangling inventory row id (uuid, matches nothing owned)'],
  ])(
    'a real weapon named by %s is still refused with weapon_not_on_sheet',
    (phrase) => {
      const grounding = groundRequestedWeapon(phrase, [GREATAXE, HANDAXE], [GREATAXE, HANDAXE]);
      // Sanity: ungrounded, so the gate — not the grounding — decides.
      expect(grounding.grounded).toBe(false);
      expect(grounding.notEquipped).toBe(false);

      const err = expectRefusal(() => refuseUngroundedPlayerWeapon(grounding, 'player'));
      expect(err.details).toMatchObject({ reason: 'weapon_not_on_sheet' });
      expect(err.message.split('Weapon not on character sheet').length - 1).toBe(1);
    },
  );

  test('a grounded claim and an empty claim never refuse, for either source', () => {
    const grounded = groundRequestedWeapon('greataxe', [GREATAXE, HANDAXE], [GREATAXE, HANDAXE]);
    expect(grounded.grounded).toBe(true);
    const empty = groundRequestedWeapon(null, [GREATAXE], [GREATAXE]);
    for (const source of ['player', 'dm'] as const) {
      expect(() => refuseUngroundedPlayerWeapon(grounded, source)).not.toThrow();
      expect(() => refuseUngroundedPlayerWeapon(empty, source)).not.toThrow();
    }
  });
});
