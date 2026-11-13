import { describe, expect, it } from 'vitest';

import { classes } from '@/data/classes';

describe('2014 level-one creation features by class (#899)', () => {
  it.each([
    ['Barbarian', ['rage', 'unarmored-defense']],
    ['Bard', ['bardic-inspiration', 'spellcasting']],
    ['Cleric', ['divine-domain', 'spellcasting']],
    ['Druid', ['druidic', 'spellcasting']],
    ['Fighter', ['fighting-style', 'second-wind']],
    ['Monk', ['unarmored-defense-monk', 'martial-arts']],
    ['Paladin', ['divine-sense', 'lay-on-hands']],
    ['Ranger', ['favored-enemy', 'natural-explorer']],
    ['Rogue', ['expertise', 'sneak-attack', 'thieves-cant']],
    ['Sorcerer', ['sorcerous-origin', 'spellcasting']],
    ['Warlock', ['otherworldly-patron', 'pact-magic']],
    ['Wizard', ['arcane-recovery', 'spellcasting']],
  ])('%s starts with its level-one features', (name, expected) => {
    const characterClass = classes.find((entry) => entry.name === name);
    expect(characterClass).toBeDefined();
    expect(characterClass!.classFeatures.map((feature) => feature.id)).toEqual(
      expect.arrayContaining(expected),
    );
  });
});
