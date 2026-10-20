/**
 * #899: level-1 class and race feature audit (Hark D20 sweep, 2014 PHB).
 *
 * The sheet's Class Features section is fed by getClassFeatures
 * (CLASS_FEATURES_MAP), while the creation wizard saves the class data in
 * src/data/classes/*.ts. Both surfaces are asserted here, per class group,
 * in both directions: features that must be present at level 1 and features
 * that must NOT appear before their level.
 */
import { describe, it, expect } from 'vitest';

import { druid } from '@/data/classes/druid';
import { monk } from '@/data/classes/monk';
import { paladin } from '@/data/classes/paladin';
import { rogue } from '@/data/classes/rogue';
import { sorcerer } from '@/data/classes/sorcerer';
import { classSubclasses } from '@/data/classes/subclasses';
import { warlock } from '@/data/classes/warlock';
import { halfOrc } from '@/data/races/half-orc';
import progressions from '@/data/srd/progressions.json';
import { getClassFeatures } from '@/utils/classFeatures';

const names = (className: string, level: number): string[] =>
  getClassFeatures(className, level).map((f) => f.name);

describe('#899 Paladin (D20-006)', () => {
  it('has Divine Sense and Lay on Hands at level 1', () => {
    expect(names('Paladin', 1)).toContain('divine_sense');
    expect(names('Paladin', 1)).toContain('lay_on_hands');
    expect(paladin.classFeatures.map((f) => f.id)).toEqual(
      expect.arrayContaining(['divine-sense', 'lay-on-hands']),
    );
  });
});

describe('#899 Monk (D20-009)', () => {
  it('has Martial Arts at level 1 and NOT Ki', () => {
    expect(names('Monk', 1)).toContain('martial_arts');
    expect(names('Monk', 1)).not.toContain('ki');
    expect(monk.classFeatures.map((f) => f.id)).toContain('martial-arts');
  });

  it('gains Ki at level 2, not before', () => {
    expect(names('Monk', 2)).toContain('ki');
    expect(getClassFeatures('Monk', 2).find((f) => f.name === 'ki')?.level).toBe(2);
  });
});

describe('#899 Rogue (D20-010)', () => {
  it("has Thieves' Cant and Sneak Attack at level 1", () => {
    expect(names('Rogue', 1)).toContain('thieves_cant');
    expect(names('Rogue', 1)).toContain('sneak_attack');
    expect(rogue.classFeatures.map((f) => f.id)).toContain('thieves-cant');
  });
});

describe('#899 Druid (D20-004)', () => {
  it('has the Druidic feature and the Druidic language at level 1', () => {
    expect(names('Druid', 1)).toContain('druidic');
    expect(druid.classFeatures.map((f) => f.id)).toContain('druidic');
    expect(druid.languages).toContain('Druidic');
  });

  it('does not carry the bogus Druidcraft class feature (Druidcraft is a cantrip)', () => {
    expect(druid.classFeatures.map((f) => f.id)).not.toContain('druidcraft');
  });
});

describe('#899 Half-Orc (D20-001)', () => {
  it('has Menacing and the Intimidation proficiency it grants', () => {
    expect(halfOrc.traits).toContain('Menacing');
    expect(halfOrc.skillProficiencies).toEqual(['Intimidation']);
  });
});

describe('#899 Sorcerer — Draconic Bloodline data (D20-011)', () => {
  it('carries Dragon Ancestor and Draconic Resilience at level 1', () => {
    const draconic = classSubclasses.sorcerer.find((s) => s.id === 'draconic-bloodline');
    expect(draconic).toBeDefined();
    const l1 = draconic!.features.filter((f) => f.level === 1).map((f) => f.id);
    expect(l1).toEqual(expect.arrayContaining(['dragon-ancestor', 'draconic-resilience']));
    expect(sorcerer.classFeatures.map((f) => f.id)).toContain('sorcerous-origin');
  });
});

describe('#899 Life Cleric data (D20-003)', () => {
  it('carries Bonus Proficiency (heavy armor) at level 1', () => {
    const life = classSubclasses.cleric.find((s) => s.id === 'life-domain');
    expect(life).toBeDefined();
    const l1 = life!.features.filter((f) => f.level === 1).map((f) => f.id);
    expect(l1).toContain('bonus-proficiency');
    expect(life!.armorProficiencies).toEqual(['Heavy armor']);
  });

  it('carries the PHB domain spells, always prepared from level 1', () => {
    const life = classSubclasses.cleric.find((s) => s.id === 'life-domain');
    expect(life!.domainSpells?.[1]).toEqual(['Bless', 'Cure Wounds']);
    expect(life!.domainSpells?.[3]).toEqual(['Lesser Restoration', 'Spiritual Weapon']);
  });
});

describe('#899 Warlock — Pact Boon gate (D20-012, pin)', () => {
  it('is not offered at level 1 anywhere in the creation data', () => {
    expect(warlock.classFeatures.map((f) => f.id)).not.toContain('pact-boon');
    expect(names('Warlock', 1)).not.toContain('pact_boon');
    expect(names('Warlock', 2)).not.toContain('pact_boon');
  });

  it('the progression table grants Pact Boon at level 3, not before', () => {
    const warlockProgression = (
      progressions as Record<string, Array<{ level: number; featureName: string }>>
    ).warlock;
    const pactBoonLevels = warlockProgression
      .filter((row) => row.featureName === 'Pact Boon')
      .map((row) => row.level);
    expect(pactBoonLevels).toEqual([3]);
    const l1Features = warlockProgression
      .filter((row) => row.level === 1)
      .map((row) => row.featureName);
    expect(l1Features).toEqual(expect.arrayContaining(['Otherworldly Patron', 'Pact Magic']));
  });
});
