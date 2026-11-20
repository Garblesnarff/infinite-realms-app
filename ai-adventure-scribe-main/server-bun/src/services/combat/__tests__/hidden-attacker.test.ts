import { describe, expect, it } from 'bun:test';

import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules.js';

const LONGSWORD: WeaponRuleProfile = {
  id: 'longsword',
  name: 'Longsword',
  damageDice: '1d8',
  damageType: 'slashing',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
};

const base = {
  strength: 14,
  dexterity: 14,
  level: 1,
  baseTargetAc: 12,
  weapon: LONGSWORD,
};

describe('Hidden attacker advantage (#1637)', () => {
  it('gives advantage from the "hidden" source', () => {
    const rules = resolveAttackRules({ ...base, attackerHidden: true });
    expect(rules.advantage).toBe(true);
    expect(rules.advantageSources).toEqual(['hidden']);
  });

  it('gives no advantage when the attacker is not hidden', () => {
    const rules = resolveAttackRules({ ...base, attackerHidden: false });
    expect(rules.advantage).toBe(false);
    expect(rules.advantageSources).toEqual([]);
  });

  it('cancels against disadvantage, as any other source does', () => {
    const rules = resolveAttackRules({
      ...base,
      attackerHidden: true,
      attackerConditions: ['poisoned'],
    });
    expect(rules.advantage).toBe(false);
    expect(rules.disadvantage).toBe(false);
  });
});
