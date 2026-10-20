/**
 * Creator level-1 spell lists vs the 2014 PHB (#902 part 1).
 *
 * The creator's per-class lists come from `getClassSpells`, which reads the same two catalog
 * files the client fallback reads (src/data/srd/spells.json +
 * src/data/spells/non-srd-supplement.json). Hark's creation sweep found Witch Bolt missing
 * from the Wizard list; the audit behind this test compared every class's level-1 list
 * against PHB chapter 11 and found seven more gaps (Faerie Fire for Bard, Chromatic Orb and
 * Ray of Sickness for Wizard, Armor of Agathys for Warlock, the three paladin smites, and
 * the ranger's Ensnaring Strike / Hail of Thorns). This test pins the full PHB lists so a
 * future catalog edit cannot silently drop one again.
 *
 * Name variants: the catalog carries some spells under their SRD names ("Hideous Laughter",
 * "Floating Disk") alongside the PHB possessive forms, so a PHB name also matches the
 * catalog entry with the leading possessive stripped (and vice versa).
 */
import { describe, expect, it } from 'vitest';

import { getClassSpells } from '../spellData.js';

const PHB_LEVEL_ONE: Record<string, string[]> = {
  bard: [
    'Animal Friendship',
    'Bane',
    'Charm Person',
    'Comprehend Languages',
    'Cure Wounds',
    'Detect Magic',
    'Disguise Self',
    'Dissonant Whispers',
    'Faerie Fire',
    'Feather Fall',
    'Healing Word',
    'Heroism',
    'Identify',
    'Illusory Script',
    'Longstrider',
    'Silent Image',
    'Sleep',
    'Speak with Animals',
    "Tasha's Hideous Laughter",
    'Thunderwave',
    'Unseen Servant',
  ],
  cleric: [
    'Bane',
    'Bless',
    'Command',
    'Create or Destroy Water',
    'Cure Wounds',
    'Detect Evil and Good',
    'Detect Magic',
    'Detect Poison and Disease',
    'Guiding Bolt',
    'Healing Word',
    'Inflict Wounds',
    'Protection from Evil and Good',
    'Purify Food and Drink',
    'Sanctuary',
    'Shield of Faith',
  ],
  druid: [
    'Animal Friendship',
    'Charm Person',
    'Create or Destroy Water',
    'Cure Wounds',
    'Detect Magic',
    'Detect Poison and Disease',
    'Entangle',
    'Faerie Fire',
    'Fog Cloud',
    'Goodberry',
    'Healing Word',
    'Jump',
    'Longstrider',
    'Purify Food and Drink',
    'Speak with Animals',
    'Thunderwave',
  ],
  paladin: [
    'Bless',
    'Command',
    'Compelled Duel',
    'Cure Wounds',
    'Detect Evil and Good',
    'Detect Magic',
    'Detect Poison and Disease',
    'Divine Favor',
    'Heroism',
    'Protection from Evil and Good',
    'Purify Food and Drink',
    'Searing Smite',
    'Shield of Faith',
    'Thunderous Smite',
    'Wrathful Smite',
  ],
  ranger: [
    'Alarm',
    'Animal Friendship',
    'Cure Wounds',
    'Detect Magic',
    'Detect Poison and Disease',
    'Ensnaring Strike',
    'Fog Cloud',
    'Goodberry',
    'Hail of Thorns',
    "Hunter's Mark",
    'Jump',
    'Longstrider',
    'Speak with Animals',
  ],
  sorcerer: [
    'Burning Hands',
    'Charm Person',
    'Chromatic Orb',
    'Color Spray',
    'Comprehend Languages',
    'Detect Magic',
    'Disguise Self',
    'Expeditious Retreat',
    'False Life',
    'Feather Fall',
    'Fog Cloud',
    'Jump',
    'Mage Armor',
    'Magic Missile',
    'Ray of Sickness',
    'Shield',
    'Silent Image',
    'Sleep',
    'Thunderwave',
    'Witch Bolt',
  ],
  warlock: [
    'Armor of Agathys',
    'Arms of Hadar',
    'Charm Person',
    'Comprehend Languages',
    'Expeditious Retreat',
    'Hellish Rebuke',
    'Hex',
    'Illusory Script',
    'Protection from Evil and Good',
    'Unseen Servant',
    'Witch Bolt',
  ],
  wizard: [
    'Alarm',
    'Burning Hands',
    'Charm Person',
    'Chromatic Orb',
    'Color Spray',
    'Comprehend Languages',
    'Detect Magic',
    'Disguise Self',
    'Expeditious Retreat',
    'False Life',
    'Feather Fall',
    'Find Familiar',
    'Fog Cloud',
    'Grease',
    'Identify',
    'Illusory Script',
    'Jump',
    'Longstrider',
    'Mage Armor',
    'Magic Missile',
    'Protection from Evil and Good',
    'Ray of Sickness',
    'Shield',
    'Silent Image',
    'Sleep',
    "Tasha's Hideous Laughter",
    "Tenser's Floating Disk",
    'Thunderwave',
    'Unseen Servant',
    'Witch Bolt',
  ],
};

/** Both the full name and, for possessive names, the part after "'s " (the SRD form). */
function nameForms(name: string): string[] {
  const lower = name.toLowerCase();
  const forms = [lower];
  const possessive = lower.indexOf("'s ");
  if (possessive >= 0) forms.push(lower.slice(possessive + 3));
  return forms;
}

describe('creator level-1 spell lists (2014 PHB, #902)', () => {
  for (const [className, phbSpells] of Object.entries(PHB_LEVEL_ONE)) {
    it(`${className} offers every PHB level-1 spell`, () => {
      const levelOneNames = new Set(
        getClassSpells(className)
          .spells.filter((spell) => spell.level === 1)
          .flatMap((spell) => nameForms(spell.name)),
      );
      const missing = phbSpells.filter(
        (name) => !nameForms(name).some((form) => levelOneNames.has(form)),
      );
      expect(missing).toEqual([]);
    });
  }

  it('Witch Bolt is a level-1 option for sorcerer, warlock and wizard', () => {
    for (const className of ['sorcerer', 'warlock', 'wizard']) {
      const witchBolt = getClassSpells(className).spells.find(
        (spell) => spell.id === 'witch-bolt',
      );
      expect(witchBolt?.level).toBe(1);
    }
  });
});
