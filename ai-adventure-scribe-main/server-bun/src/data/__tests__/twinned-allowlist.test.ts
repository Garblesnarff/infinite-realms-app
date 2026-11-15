/**
 * #1508: Twinned Spell fails closed. The engine admits a spell only when it is on the single-target
 * allowlist, so a spell nobody reviewed is refused. Each allowlisted id must be a real catalog
 * spell that is neither an area nor a Self spell, so the list cannot drift from the spell data.
 */
import { describe, expect, it } from 'bun:test';

import {
  resolveCatalogSpell,
  TWINNABLE_SINGLE_TARGET_SPELL_IDS,
  twinnedAllowed,
} from '../spellData.js';

describe('Twinned Spell allowlist (#1508)', () => {
  it('every allowlisted id is a catalog spell that is neither an area nor a Self spell', () => {
    for (const id of TWINNABLE_SINGLE_TARGET_SPELL_IDS) {
      const spell = resolveCatalogSpell(id);
      expect(spell, `${id} is not in the spell data`).toBeDefined();
      expect(spell?.areaOfEffect, `${id} is an area spell`).toBeUndefined();
      expect(/^self\b/i.test(spell?.range.trim() ?? ''), `${id} is a Self spell`).toBe(false);
    }
  });

  it('admits a listed single-target spell', () => {
    const fireBolt = resolveCatalogSpell('fire-bolt');
    expect(fireBolt).toBeDefined();
    expect(twinnedAllowed(fireBolt!)).toBe(true);
  });

  it('refuses Burning Hands (an area in the 2014 rules) and Bless (up to three creatures)', () => {
    for (const id of ['burning-hands', 'bless']) {
      const spell = resolveCatalogSpell(id);
      expect(spell, `${id} is not in the spell data`).toBeDefined();
      expect(twinnedAllowed(spell!), id).toBe(false);
    }
  });

  it('refuses Magic Missile, which hits up to three creatures', () => {
    const spell = resolveCatalogSpell('magic-missile');
    expect(twinnedAllowed(spell!)).toBe(false);
  });

  // #1508 FIX (strategist on #1534): each gains a target per slot level above its own (2014 SRD), so
  // Twinned must be refused for them. They are not on the allowlist, and the allowlist has no slot
  // level to check. The real-route refusal path calls this same function before any cost is spent.
  it('refuses Hold Person and Charm Person, which gain targets when upcast', () => {
    for (const id of ['hold-person', 'charm-person']) {
      const spell = resolveCatalogSpell(id);
      expect(spell, `${id} is not in the spell data`).toBeDefined();
      expect(TWINNABLE_SINGLE_TARGET_SPELL_IDS.has(id), id).toBe(false);
      expect(twinnedAllowed(spell!), id).toBe(false);
    }
  });

  it('refuses a spell id that is not in the catalog', () => {
    expect(resolveCatalogSpell('not-a-catalog-spell')).toBeUndefined();
  });
});
