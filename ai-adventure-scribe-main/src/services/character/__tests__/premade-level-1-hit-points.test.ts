/**
 * #52: every seeded premade's level-1 max HP equals the 2014 SRD value: class hit die max + CON
 * modifier, + 1 for a Hill Dwarf (Dwarven Toughness), + 1 for a Draconic Bloodline sorcerer. The
 * server stores computeMaxHitPointsForLevel over the seed payload (character-service.ts create path).
 */
import { describe, expect, it } from 'vitest';

import { readSeededPremadeTemplates } from './seeded-premade-templates';
import { isDraconicBloodline } from '../../../../shared/class-feature-choices';
import { computeMaxHitPointsForLevel } from '../../../../shared/level-1-hit-points';
import { buildStarterCharacterSeed } from '../starter-character-seeding';

import type { StarterCharacterCreatePayload } from '../starter-character-seeding';

type ExpectedRow = {
  campaign: string;
  templateKey: string;
  className: string;
  race: string;
  subrace: string | null;
  subclass: string | null;
  con: number;
  maxHp: number;
};

// Subrace and subclass are pinned so a seed that gains Hill Dwarf or Draconic Bloodline fails here until its expected HP is updated.
// prettier-ignore
const EXPECTED: ExpectedRow[] = [
  { campaign: 'abyssal-descent', templateKey: 'the-veteran', className: 'Fighter', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 12 },
  { campaign: 'abyssal-descent', templateKey: 'the-scholar', className: 'Wizard', race: 'Human', subrace: null, subclass: null, con: 12, maxHp: 7 },
  { campaign: 'abyssal-descent', templateKey: 'the-hunter', className: 'Ranger', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 12 },
  { campaign: 'abyssal-descent', templateKey: 'the-pact-bound', className: 'Warlock', race: 'Tiefling', subrace: null, subclass: null, con: 14, maxHp: 10 },
  { campaign: 'abyssal-descent', templateKey: 'the-exile', className: 'Ranger', race: 'Elf', subrace: 'Drow', subclass: null, con: 12, maxHp: 11 },
  { campaign: 'the-eternal-feast', templateKey: 'the-storyteller', className: 'Bard', race: 'Half-Elf', subrace: null, subclass: null, con: 12, maxHp: 9 },
  { campaign: 'the-eternal-feast', templateKey: 'the-faithful', className: 'Cleric', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 10 },
  { campaign: 'the-eternal-feast', templateKey: 'the-lucky-one', className: 'Rogue', race: 'Halfling', subrace: null, subclass: null, con: 12, maxHp: 9 },
  { campaign: 'the-eternal-feast', templateKey: 'the-reveler', className: 'Barbarian', race: 'Satyr', subrace: null, subclass: null, con: 14, maxHp: 14 },
  { campaign: 'the-eternal-feast', templateKey: 'the-seeker', className: 'Ranger', race: 'Catfolk', subrace: null, subclass: null, con: 12, maxHp: 11 },
  { campaign: 'curse-of-the-jersey-devil', templateKey: 'the-tracker', className: 'Ranger', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 12 },
  { campaign: 'curse-of-the-jersey-devil', templateKey: 'the-circuit-preacher', className: 'Cleric', race: 'Human', subrace: null, subclass: null, con: 15, maxHp: 10 },
  { campaign: 'curse-of-the-jersey-devil', templateKey: 'the-almanac-keeper', className: 'Wizard', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 8 },
  { campaign: 'curse-of-the-jersey-devil', templateKey: 'the-moonshiner', className: 'Rogue', race: 'Halfling', subrace: 'Lightfoot Halfling', subclass: null, con: 15, maxHp: 10 },
  { campaign: 'curse-of-the-jersey-devil', templateKey: 'the-furnace-born', className: 'Fighter', race: 'Half-Orc', subrace: null, subclass: null, con: 16, maxHp: 13 },
  { campaign: 'the-impossible-vault', templateKey: 'the-cardsharp', className: 'Bard', race: 'Half-Elf', subrace: null, subclass: null, con: 12, maxHp: 9 },
  { campaign: 'the-impossible-vault', templateKey: 'the-cracksman', className: 'Rogue', race: 'Halfling', subrace: 'Lightfoot Halfling', subclass: null, con: 13, maxHp: 9 },
  { campaign: 'the-impossible-vault', templateKey: 'the-bouncer', className: 'Fighter', race: 'Half-Orc', subrace: null, subclass: null, con: 15, maxHp: 12 },
  { campaign: 'the-impossible-vault', templateKey: 'the-chaplain', className: 'Cleric', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 10 },
  { campaign: 'the-impossible-vault', templateKey: 'the-luck-scholar', className: 'Wizard', race: 'Gnome', subrace: 'Rock Gnome', subclass: null, con: 13, maxHp: 7 },
  { campaign: 'wings-of-the-void', templateKey: 'the-rimrunner', className: 'Rogue', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 10 },
  { campaign: 'wings-of-the-void', templateKey: 'the-rigger', className: 'Fighter', race: 'Dwarf', subrace: 'Hill Dwarf', subclass: null, con: 16, maxHp: 14 },
  { campaign: 'wings-of-the-void', templateKey: 'the-cartographer', className: 'Wizard', race: 'Gnome', subrace: 'Rock Gnome', subclass: null, con: 14, maxHp: 8 },
  { campaign: 'wings-of-the-void', templateKey: 'the-windspeaker', className: 'Cleric', race: 'Half-Elf', subrace: null, subclass: null, con: 14, maxHp: 10 },
  { campaign: 'wings-of-the-void', templateKey: 'the-deserter', className: 'Ranger', race: 'Half-Orc', subrace: null, subclass: null, con: 14, maxHp: 12 },
  { campaign: 'journey-to-the-inner-world', templateKey: 'the-driller', className: 'Fighter', race: 'Dwarf', subrace: 'Hill Dwarf', subclass: null, con: 16, maxHp: 14 },
  { campaign: 'journey-to-the-inner-world', templateKey: 'the-surveyor', className: 'Wizard', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 8 },
  { campaign: 'journey-to-the-inner-world', templateKey: 'the-lamplighter', className: 'Rogue', race: 'Halfling', subrace: 'Lightfoot Halfling', subclass: null, con: 14, maxHp: 10 },
  { campaign: 'journey-to-the-inner-world', templateKey: 'the-chaplain', className: 'Cleric', race: 'Human', subrace: null, subclass: null, con: 15, maxHp: 10 },
  { campaign: 'journey-to-the-inner-world', templateKey: 'the-echo', className: 'Bard', race: 'Ravenfolk', subrace: null, subclass: null, con: 13, maxHp: 9 },
  { campaign: 'a-midsummer-nights-chaos', templateKey: 'the-thespian', className: 'Bard', race: 'Human', subrace: null, subclass: null, con: 12, maxHp: 9 },
  { campaign: 'a-midsummer-nights-chaos', templateKey: 'the-lovesick', className: 'Sorcerer', race: 'Half-Elf', subrace: null, subclass: 'Draconic Bloodline', con: 14, maxHp: 9 },
  { campaign: 'a-midsummer-nights-chaos', templateKey: 'the-woodsman', className: 'Ranger', race: 'Elf', subrace: 'Wood Elf', subclass: null, con: 12, maxHp: 11 },
  { campaign: 'a-midsummer-nights-chaos', templateKey: 'the-runaway', className: 'Rogue', race: 'Halfling', subrace: 'Lightfoot', subclass: null, con: 12, maxHp: 9 },
  { campaign: 'a-midsummer-nights-chaos', templateKey: 'the-hedgewitch', className: 'Druid', race: 'Gnome', subrace: 'Forest Gnome', subclass: null, con: 14, maxHp: 10 },
  { campaign: 'academy-of-arcane-gastronomy', templateKey: 'the-oathbound', className: 'Paladin', race: 'Human', subrace: null, subclass: null, con: 14, maxHp: 12 },
  { campaign: 'academy-of-arcane-gastronomy', templateKey: 'the-apprentice', className: 'Wizard', race: 'Human', subrace: null, subclass: null, con: 12, maxHp: 7 },
  { campaign: 'academy-of-arcane-gastronomy', templateKey: 'the-kitchen-hand', className: 'Rogue', race: 'Halfling', subrace: null, subclass: null, con: 12, maxHp: 9 },
  { campaign: 'academy-of-arcane-gastronomy', templateKey: 'the-gourmand', className: 'Fighter', race: 'Dwarf', subrace: 'Hill Dwarf', subclass: null, con: 16, maxHp: 14 },
  { campaign: 'academy-of-arcane-gastronomy', templateKey: 'the-herbalist', className: 'Druid', race: 'Half-Elf', subrace: null, subclass: null, con: 12, maxHp: 9 },
  { campaign: 'academy-of-arcane-gastronomy', templateKey: 'the-sous-chef', className: 'Sorcerer', race: 'Tiefling', subrace: null, subclass: 'Draconic Bloodline', con: 14, maxHp: 9 },
];

describe('premade level-1 hit points (#52)', () => {
  it('covers exactly the seeded premades', () => {
    const seededKeys = readSeededPremadeTemplates().map(
      (template) => `${template.starter_campaign_id}/${template.template_key}`,
    );
    const expectedKeys = EXPECTED.map((row) => `${row.campaign}/${row.templateKey}`);
    expect([...seededKeys].sort()).toEqual([...expectedKeys].sort());
  });

  it.each(EXPECTED)('$campaign/$templateKey has the seeded level-1 max HP', (row) => {
    const template = readSeededPremadeTemplates().find(
      (candidate) =>
        candidate.starter_campaign_id === row.campaign &&
        candidate.template_key === row.templateKey,
    );
    if (!template) throw new Error(`no seeded premade ${row.campaign}/${row.templateKey}`);

    const payload = buildStarterCharacterSeed(
      template,
      row.campaign,
    ) as StarterCharacterCreatePayload;
    const stats = payload.stats as { constitution: number };

    expect(payload.class).toBe(row.className);
    expect(payload.race).toBe(row.race);
    expect(payload.subrace ?? null).toBe(row.subrace);
    expect(payload.subclass ?? null).toBe(row.subclass);
    expect(payload.level).toBe(1);
    expect(stats.constitution).toBe(row.con);

    const draconicBloodline =
      isDraconicBloodline((payload as { classFeatures?: unknown }).classFeatures) ||
      payload.subclass === 'Draconic Bloodline';

    const serverHp = computeMaxHitPointsForLevel(
      payload.class as string,
      stats.constitution,
      (payload.subrace as string | null) ?? null,
      payload.level as number,
      { draconicBloodline },
    );

    expect(serverHp).toBe(row.maxHp);
  });

  it('each row maxHp equals the independent SRD sum', () => {
    const HIT_DIE: Record<string, number> = {
      Barbarian: 12,
      Fighter: 10,
      Paladin: 10,
      Ranger: 10,
      Bard: 8,
      Cleric: 8,
      Druid: 8,
      Monk: 8,
      Rogue: 8,
      Warlock: 8,
      Sorcerer: 6,
      Wizard: 6,
    };
    for (const row of EXPECTED) {
      const independent =
        HIT_DIE[row.className] +
        Math.floor((row.con - 10) / 2) +
        (row.subrace === 'Hill Dwarf' ? 1 : 0) +
        (row.className === 'Sorcerer' && row.subclass === 'Draconic Bloodline' ? 1 : 0);
      expect(row.maxHp).toBe(independent);
    }
  });

  it('the-gourmand replayed template has wisdom 11', () => {
    const template = readSeededPremadeTemplates().find(
      (candidate) =>
        candidate.starter_campaign_id === 'academy-of-arcane-gastronomy' &&
        candidate.template_key === 'the-gourmand',
    );
    if (!template) throw new Error('no gourmand template');
    const scores = (template.ability_scores ?? template.abilityScores) as Record<string, number>;
    const wisdom = scores.WIS ?? scores.wisdom;
    expect(wisdom).toBe(11);
  });
});
