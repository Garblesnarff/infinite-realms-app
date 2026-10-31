/**
 * #1225: the engine's table of limited-feature counts (shared/limited-feature-counts.ts). The
 * seed generator and the data-only migration are pinned by the client-side vitest
 * src/utils/__tests__/limited-feature-seed-1225.test.ts (the generator imports client data the
 * server typecheck cannot resolve).
 */
import { describe, expect, it } from 'bun:test';

import {
  familyCountRule,
  fixedFeatureUses,
  limitedFeatureRule,
  type LimitedFeatureContext,
} from '../../../../../shared/limited-feature-counts';

const ctx = (classLevel: number, mods: LimitedFeatureContext['abilityModifiers'] = null) => ({
  classLevel,
  abilityModifiers: mods,
});
const usesAt = (className: string, featureName: string, c: LimitedFeatureContext) => {
  const rule = limitedFeatureRule(className, featureName);
  if (rule?.kind !== 'count') throw new Error(`${className}/${featureName} has no count rule`);
  return rule.usesAt(c);
};

describe('limited feature counts (#1225)', () => {
  it('counts by level from code, not from per-tier rows', () => {
    expect([1, 3, 6, 12, 17, 20].map((l) => usesAt('Barbarian', 'Rage', ctx(l)))).toEqual([
      2,
      3,
      4,
      5,
      6,
      'unlimited',
    ]);
    // Every Channel Divinity tier row reads the same count at the same level.
    for (const name of [
      'Channel Divinity',
      'Channel Divinity (1/rest)',
      'Channel Divinity (2/rest)',
    ]) {
      expect(usesAt('Cleric', name, ctx(6))).toBe(2);
      expect(usesAt('Cleric', name, ctx(18))).toBe(3);
    }
    expect(limitedFeatureRule('Cleric', 'Channel Divinity (1/rest)')).toMatchObject({
      family: 'cleric-channel-divinity',
    });
    expect(usesAt('Fighter', 'Indomitable (two uses)', ctx(13))).toBe(2);
    expect(usesAt('Monk', 'Ki', ctx(7))).toBe(7);
    expect(usesAt('Sorcerer', 'Font of Magic', ctx(5))).toBe(5);
  });

  it('counts by ability with a minimum of one, and refuses to guess without scores', () => {
    expect(usesAt('Bard', 'Bardic Inspiration (d6)', ctx(1, { charisma: 3 }))).toBe(3);
    expect(usesAt('Bard', 'Bardic Inspiration (d6)', ctx(1, { charisma: -1 }))).toBe(1);
    expect(usesAt('Bard', 'Bardic Inspiration (d6)', ctx(1, null))).toBeNull();
    const rule = limitedFeatureRule('Bard', 'Bardic Inspiration (d8)');
    expect(rule?.kind === 'count' && rule.rechargeAt?.(ctx(5))).toBe('short_rest');
    expect(rule?.kind === 'count' && rule.rechargeAt?.(ctx(4))).toBe('long_rest');
  });

  it('names what a feature spends instead of giving it uses of its own', () => {
    // Round 2: a Channel Divinity option draws one use from the class's Channel Divinity family.
    expect(limitedFeatureRule('Cleric', 'Channel Divinity: Preserve Life')).toEqual({
      kind: 'spends',
      pool: 'Channel Divinity',
      route: { family: 'cleric-channel-divinity', cost: 1 },
    });
    expect(limitedFeatureRule('Paladin', 'Lay on Hands')).toEqual({ kind: 'pool' });
    expect(limitedFeatureRule('Bard', 'Song of Rest (d6)')).toEqual({ kind: 'not_counted' });
    expect(limitedFeatureRule('Fighter', 'Not A Feature')).toBeNull();
  });

  it('classifies "spends another" features by the family they spend, not by a rest tag (round 2)', () => {
    const route = (className: string, featureName: string) => {
      const rule = limitedFeatureRule(className, featureName);
      if (rule?.kind !== 'spends') throw new Error(`${className}/${featureName} is not a spender`);
      return rule.route;
    };
    expect(route('Cleric', 'Channel Divinity: Turn Undead')).toEqual({
      family: 'cleric-channel-divinity',
      cost: 1,
    });
    for (const name of [
      'Flurry of Blows',
      'Patient Defense',
      'Step of the Wind',
      'Stunning Strike',
    ]) {
      expect(route('Monk', name)).toEqual({ family: 'monk-ki', cost: 1 });
    }
    expect(route('Monk', 'Quivering Palm')).toEqual({ family: 'monk-ki', cost: 3 });
    expect(route('Monk', 'Empty Body')).toEqual({ family: 'monk-ki', cost: 4 });
    expect(route('Paladin', 'Channel Divinity: Sacred Weapon')).toEqual({
      family: 'paladin-channel-divinity',
      cost: 1,
    });
    expect(route('Sorcerer', 'Draconic Presence')).toEqual({
      family: 'sorcerer-sorcery-points',
      cost: 5,
    });
    // The cost varies by option or is a spell slot: refused with the reason, never free.
    expect(route('Sorcerer', 'Metamagic')).toBeNull();
    expect(route('Sorcerer', 'Flexible Casting: Creating Spell Slots')).toBeNull();
    expect(route('Paladin', 'Divine Smite')).toBeNull();
    // Every route lands on a counted family.
    for (const [className, name] of [
      ['Cleric', 'Channel Divinity: Turn Undead'],
      ['Monk', 'Flurry of Blows'],
      ['Paladin', 'Channel Divinity: Turn the Unholy'],
      ['Sorcerer', 'Draconic Presence'],
    ]) {
      expect(familyCountRule(route(className, name)!.family)?.kind).toBe('count');
    }
  });

  it('the rest that refills a counted feature comes from the table (round 2)', () => {
    const rechargeAt = (className: string, featureName: string, level: number) => {
      const rule = limitedFeatureRule(className, featureName);
      if (rule?.kind !== 'count') throw new Error(`${className}/${featureName} has no count rule`);
      return rule.rechargeAt(ctx(level));
    };
    // "Once per day when you finish a short rest" (PHB p.115): regained on a long rest.
    expect(rechargeAt('Wizard', 'Arcane Recovery', 1)).toBe('long_rest');
    expect(rechargeAt('Monk', 'Ki', 2)).toBe('short_rest');
    expect(rechargeAt('Cleric', 'Channel Divinity (1/rest)', 2)).toBe('short_rest');
    expect(rechargeAt('Barbarian', 'Rage', 3)).toBe('long_rest');
    expect(rechargeAt('Sorcerer', 'Font of Magic', 2)).toBe('long_rest');
  });

  it('fixed counts: the same number at every level, or the count a tier row names', () => {
    expect(fixedFeatureUses('Fighter', 'Second Wind')).toBe(1);
    expect(fixedFeatureUses('Wizard', 'Signature Spell')).toBe(2);
    expect(fixedFeatureUses('Cleric', 'Channel Divinity (3/rest)')).toBe(3);
    expect(fixedFeatureUses('Barbarian', 'Rage')).toBeNull();
    expect(fixedFeatureUses('Bard', 'Bardic Inspiration (d6)')).toBeNull();
  });
});
