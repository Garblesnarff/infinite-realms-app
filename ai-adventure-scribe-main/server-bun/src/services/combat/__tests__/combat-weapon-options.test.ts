import { describe, expect, test } from 'bun:test';

import { readSeededPremadeTemplates } from '../../../../../src/services/character/__tests__/seeded-premade-templates.ts';
import { resolveAttackRules } from '../combat-rules.js';
import { buildCombatWeaponOptions, isEquippedWeaponCandidate } from '../combat-weapon-options.js';
import { findCatalogWeapon } from '../weapon-catalog.js';

import type { WeaponRuleProfile } from '../combat-rules.js';

const profileFor = (name: string): WeaponRuleProfile => {
  const catalog = findCatalogWeapon(name);
  if (!catalog) throw new Error(`expected seeded weapon ${name} in the SRD catalog`);
  return {
    id: catalog.id,
    name: catalog.name,
    damageDice: catalog.damage?.dice ?? '1d4',
    damageType: catalog.damage?.type ?? 'bludgeoning',
    normalRange: catalog.range?.normal ?? 5,
    longRange: catalog.range?.long,
    magicBonus: 0,
    finesse: Boolean(catalog.weaponProperties?.finesse),
    ranged: (catalog.range?.normal ?? 5) > 5,
    proficient: true,
  };
};

type ExpectedSeededWeapon = {
  name: string;
  ranged: boolean;
  reachFeet?: number;
  normalRange?: number;
  longRange?: number;
};

/** Literal weapon kits from the 30 seeded rows; this must not be derived from the resolver. */
const EXPECTED_SEEDED_WEAPONS: Array<{
  campaign: string;
  templateKey: string;
  weapons: ExpectedSeededWeapon[];
}> = [
  {
    campaign: 'abyssal-descent',
    templateKey: 'the-veteran',
    weapons: [
      { name: 'Longsword', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'abyssal-descent',
    templateKey: 'the-scholar',
    weapons: [{ name: 'Quarterstaff', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'abyssal-descent',
    templateKey: 'the-hunter',
    weapons: [
      { name: 'Longbow', ranged: true, normalRange: 150, longRange: 600 },
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'abyssal-descent',
    templateKey: 'the-pact-bound',
    weapons: [{ name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 }],
  },
  {
    campaign: 'abyssal-descent',
    templateKey: 'the-exile',
    weapons: [
      { name: 'Crossbow, hand', ranged: true, normalRange: 30, longRange: 120 },
      { name: 'Rapier', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'the-eternal-feast',
    templateKey: 'the-storyteller',
    weapons: [{ name: 'Rapier', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'the-eternal-feast',
    templateKey: 'the-faithful',
    weapons: [{ name: 'Mace', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'the-eternal-feast',
    templateKey: 'the-lucky-one',
    weapons: [
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
      { name: 'Shortbow', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'the-eternal-feast',
    templateKey: 'the-reveler',
    weapons: [
      { name: 'Greataxe', ranged: false, reachFeet: 5 },
      { name: 'Handaxe', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'the-eternal-feast',
    templateKey: 'the-seeker',
    weapons: [
      { name: 'Longbow', ranged: true, normalRange: 150, longRange: 600 },
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'curse-of-the-jersey-devil',
    templateKey: 'the-tracker',
    weapons: [
      { name: 'Longbow', ranged: true, normalRange: 150, longRange: 600 },
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'curse-of-the-jersey-devil',
    templateKey: 'the-circuit-preacher',
    weapons: [{ name: 'Mace', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'curse-of-the-jersey-devil',
    templateKey: 'the-almanac-keeper',
    weapons: [{ name: 'Quarterstaff', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'curse-of-the-jersey-devil',
    templateKey: 'the-moonshiner',
    weapons: [
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, hand', ranged: true, normalRange: 30, longRange: 120 },
    ],
  },
  {
    campaign: 'curse-of-the-jersey-devil',
    templateKey: 'the-furnace-born',
    weapons: [
      { name: 'Battleaxe', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'the-impossible-vault',
    templateKey: 'the-cardsharp',
    weapons: [
      { name: 'Rapier', ranged: false, reachFeet: 5 },
      { name: 'Dagger', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'the-impossible-vault',
    templateKey: 'the-cracksman',
    weapons: [
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
      { name: 'Shortbow', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'the-impossible-vault',
    templateKey: 'the-bouncer',
    weapons: [
      { name: 'Longsword', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'the-impossible-vault',
    templateKey: 'the-chaplain',
    weapons: [
      { name: 'Mace', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'the-impossible-vault',
    templateKey: 'the-luck-scholar',
    weapons: [
      { name: 'Quarterstaff', ranged: false, reachFeet: 5 },
      { name: 'Dagger', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'wings-of-the-void',
    templateKey: 'the-rimrunner',
    weapons: [
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
      { name: 'Dagger', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'wings-of-the-void',
    templateKey: 'the-rigger',
    weapons: [
      { name: 'Warhammer', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'wings-of-the-void',
    templateKey: 'the-cartographer',
    weapons: [{ name: 'Quarterstaff', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'wings-of-the-void',
    templateKey: 'the-windspeaker',
    weapons: [{ name: 'Mace', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'wings-of-the-void',
    templateKey: 'the-deserter',
    weapons: [
      { name: 'Longbow', ranged: true, normalRange: 150, longRange: 600 },
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'journey-to-the-inner-world',
    templateKey: 'the-driller',
    weapons: [
      { name: 'Warhammer', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'journey-to-the-inner-world',
    templateKey: 'the-surveyor',
    weapons: [{ name: 'Quarterstaff', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'journey-to-the-inner-world',
    templateKey: 'the-lamplighter',
    weapons: [
      { name: 'Shortsword', ranged: false, reachFeet: 5 },
      { name: 'Shortbow', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'journey-to-the-inner-world',
    templateKey: 'the-chaplain',
    weapons: [{ name: 'Mace', ranged: false, reachFeet: 5 }],
  },
  {
    campaign: 'journey-to-the-inner-world',
    templateKey: 'the-echo',
    weapons: [
      { name: 'Rapier', ranged: false, reachFeet: 5 },
      { name: 'Dagger', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    templateKey: 'the-apprentice',
    weapons: [
      { name: 'Quarterstaff', ranged: false, reachFeet: 5 },
      { name: 'Dagger', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    templateKey: 'the-kitchen-hand',
    weapons: [
      { name: 'Dagger', ranged: false, reachFeet: 5 },
      { name: 'Shortbow', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    templateKey: 'the-gourmand',
    weapons: [
      { name: 'Handaxe', ranged: false, reachFeet: 5 },
      { name: 'Longsword', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    templateKey: 'the-herbalist',
    weapons: [
      { name: 'Scimitar', ranged: false, reachFeet: 5 },
      { name: 'Dagger', ranged: false, reachFeet: 5 },
    ],
  },
  {
    campaign: 'academy-of-arcane-gastronomy',
    templateKey: 'the-sous-chef',
    weapons: [
      { name: 'Dagger', ranged: false, reachFeet: 5 },
      { name: 'Crossbow, light', ranged: true, normalRange: 80, longRange: 320 },
    ],
  },
];

const expectedFor = (template: { starter_campaign_id: string; template_key: string }) => {
  const expected = EXPECTED_SEEDED_WEAPONS.find(
    (entry) =>
      entry.campaign === template.starter_campaign_id &&
      entry.templateKey === template.template_key,
  );
  if (!expected)
    throw new Error(
      `missing literal weapon kit for ${template.starter_campaign_id}/${template.template_key}`,
    );
  return expected.weapons;
};

const actualProfilesFor = (equipment: string[]): WeaponRuleProfile[] => {
  const profiles = new Map<string, WeaponRuleProfile>();
  for (const name of equipment) {
    const catalog = findCatalogWeapon(name);
    if (!catalog || profiles.has(catalog.id) || profiles.size >= 2) continue;
    profiles.set(catalog.id, profileFor(name));
  }
  return [...profiles.values()];
};

describe('combat weapon option builder', () => {
  test('offers one correctly gated attack per weapon for all 35 seeded premades', () => {
    const templates = readSeededPremadeTemplates();
    expect(templates).toHaveLength(35);

    for (const template of templates) {
      const expectedWeapons = expectedFor(template);
      // The literal kit above is the independent expectation. The seed equips only its first two
      // distinct weapons; mirror that production payload boundary before building menu profiles.
      const weapons = actualProfilesFor(template.equipment);
      const options = buildCombatWeaponOptions(weapons, (weapon) => {
        const rules = resolveAttackRules({
          strength: 10,
          dexterity: 10,
          level: 1,
          baseTargetAc: 12,
          weapon,
          geometry: { distanceFeet: 50, hasLineOfSight: true, cover: 0 },
        });
        return [{ targetId: 'hostile-1', legal: rules.legal, refusal: rules.refusal }];
      });

      expect(options, template.template_key).toHaveLength(expectedWeapons.length);
      expect(
        options.map((option) => option.label),
        template.template_key,
      ).toEqual(
        expectedWeapons.map((weapon) =>
          weapon.ranged && (weapon.longRange ?? weapon.normalRange ?? 0) >= 50
            ? `Attack with ${weapon.name}`
            : !weapon.ranged && (weapon.reachFeet ?? 0) < 50
              ? `Attack with ${weapon.name} (move closer first)`
              : `Attack with ${weapon.name}`,
        ),
      );
    }
  });

  test('gates the Veteran melee and ranged options by real attack geometry', () => {
    const veteran = readSeededPremadeTemplates().find(
      (template) =>
        template.starter_campaign_id === 'abyssal-descent' &&
        template.template_key === 'the-veteran',
    );
    if (!veteran) throw new Error('missing the-veteran seed');
    const weapons = actualProfilesFor(veteran.equipment);
    const optionsAt = (distanceFeet: number) =>
      buildCombatWeaponOptions(weapons, (weapon) => {
        const rules = resolveAttackRules({
          strength: 10,
          dexterity: 10,
          level: 1,
          baseTargetAc: 12,
          weapon,
          geometry: { distanceFeet, hasLineOfSight: true, cover: 0 },
        });
        return [{ targetId: 'hostile-1', legal: rules.legal, refusal: rules.refusal }];
      });

    expect(optionsAt(50).map((option) => option.label)).toEqual([
      'Attack with Longsword (move closer first)',
      'Attack with Crossbow, light',
    ]);
    expect(optionsAt(5).map((option) => option.label)).toEqual([
      'Attack with Longsword',
      'Attack with Crossbow, light',
    ]);
  });

  test('supports a custom non-SRD weapon without a hard-coded name', () => {
    const options = buildCombatWeaponOptions(
      [
        {
          id: 'custom-moonblade',
          name: 'Moonblade of the Tides',
          damageDice: '1d8',
          damageType: 'radiant',
          normalRange: 5,
          magicBonus: 0,
          finesse: true,
          ranged: false,
          proficient: true,
        },
      ],
      () => [{ targetId: 'hostile-1', legal: false, refusal: 'out_of_range' }],
    );

    expect(options).toEqual([
      expect.objectContaining({
        label: 'Attack with Moonblade of the Tides (move closer first)',
        weaponId: 'custom-moonblade',
      }),
    ]);
  });

  test('recognizes the wizard equipment-loader fallback and custom weapon rows', () => {
    expect(isEquippedWeaponCandidate({ itemType: 'equipment', name: 'quarterstaff' })).toBe(true);
    expect(
      isEquippedWeaponCandidate({
        itemType: 'custom',
        name: 'Moonblade of the Tides',
        properties: { damage: { dice: '1d8', type: 'radiant' } },
      }),
    ).toBe(true);
    expect(isEquippedWeaponCandidate({ itemType: 'custom', name: 'Lantern' })).toBe(false);
    expect(isEquippedWeaponCandidate({ itemType: 'equipment', name: "scholar's pack" })).toBe(
      false,
    );
  });
});
