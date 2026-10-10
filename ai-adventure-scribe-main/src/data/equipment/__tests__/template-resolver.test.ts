import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveEquipmentByName } from '@/data/equipment/resolver';
import { extractStarterTemplateEquipment, extractStarterTemplateEquipmentWithKeys } from '@/data/equipment/template-audit';
import {
  transformStarterEquipment,
  transformStarterInventory,
} from '@/services/character/starter-character-seeding';

function sqlFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sqlFiles(path) : entry.name.endsWith('.sql') ? [path] : [];
  });
}

// Plain-string seed items that are campaign flavor rather than SRD equipment. They become
// described trinkets on purpose; a new name here needs the same decision.
const CUSTOM_FLAVOR_ITEMS = [
  'trophy from fallen enemy',
  'trophy from dangerous quarry',
  'ink and quill',
  'research notes on the Abyss',
  'eldritch focus',
  'dark ritual components',
  "patron's gift",
  'dark cloak',
  'underground survival kit',
  'Underdark navigation tools',
  'journal filled with stories',
  'prayer book',
  'hospitality vestments',
  'lucky charms',
  'serving tray',
  'Feywild party favors',
  'artifacts from various cultures',
  'hand bell',
  'brass pocket telescope',
  'copper still coil',
  'iron slag talisman',
  'deck of marked cards',
  'brass magnifying loupe',
  'patched wingsuit',
  "rigger's needle roll",
  'brass altimeter',
  'waxed chart case',
  'wind-chime charm',
  'Council patrol insignia',
  'brass drill-bit pendant',
  'brass survey theodolite',
  'waxed map case',
  'chapel bell clapper',
  'sound-shell that replays one sound',
];

describe('starter template equipment resolver audit', () => {
  it('resolves the seven curated custom-item aliases without broad journal matching', () => {
    const aliases = {
      'fine clothes': 'Clothes, fine',
      'quiver with 20 arrows': 'Arrows (20)',
      "ranger's pack": "Explorer's Pack",
      journal: 'Book',
      'pan pipes': 'Pan flute',
      'costume collection': 'Clothes, costume',
      'wine flask': 'Flask or tankard',
    };

    for (const [alias, expectedName] of Object.entries(aliases)) {
      expect(resolveEquipmentByName(alias)?.name).toBe(expectedName);
    }
    expect(resolveEquipmentByName('journal filled with stories')).toBeUndefined();
    for (const deliberatelyCustom of [
      'hospitality vestments',
      'prayer book',
      'Feywild party favors',
      'artifacts from various cultures',
      'lucky charms',
      'serving tray',
    ]) {
      expect(resolveEquipmentByName(deliberatelyCustom)).toBeUndefined();
    }
  });

  it('retains every premade template item and describes every custom item', () => {
    const migrationRoot = join(process.cwd(), 'supabase/migrations');
    const templateLists = sqlFiles(migrationRoot).flatMap((path) =>
      extractStarterTemplateEquipment(readFileSync(path, 'utf8')),
    );

    expect(templateLists.length).toBeGreaterThan(0);
    for (const equipment of templateLists) {
      const records = transformStarterEquipment(equipment);
      const customItems = transformStarterInventory(equipment);

      expect(records).not.toContainEqual(
        expect.objectContaining({ item_type: 'gear', item_name: '' }),
      );
      expect(customItems.every((item) => item.item_type === 'trinket' && item.weight === 0)).toBe(
        true,
      );
      expect(customItems.every((item) => item.description.trim().length > 0)).toBe(true);
      expect(
        equipment.every((item) => {
          const name = typeof item === 'string' ? item : item.name;
          return (
            Boolean(resolveEquipmentByName(name)) ||
            customItems.some((custom) => custom.name === name)
          );
        }),
      ).toBe(true);
    }
  });

  it('resolves SRD "Noun, adjective" items written as adjective-first names', () => {
    const expected = {
      'light crossbow': ['Crossbow, light', 'weapon', 5],
      'heavy crossbow': ['Crossbow, heavy', 'weapon', 18],
      'hand crossbow': ['Crossbow, hand', 'weapon', 3],
      'hooded lantern': ['Lantern, hooded', 'gear', 0],
      'bullseye lantern': ['Lantern, bullseye', 'gear', 0],
      'studded leather': ['Studded Leather', 'armor', 13],
    } as const;
    for (const [alias, [name, category, weight]] of Object.entries(expected)) {
      const resolved = resolveEquipmentByName(alias);
      expect(resolved?.name.toLowerCase()).toBe(name.toLowerCase());
      expect(resolved?.category).toBe(category);
      expect(resolved?.weight).toBe(weight);
    }
    expect(transformStarterEquipment(['light crossbow', 'hooded lantern'])).toEqual([
      expect.objectContaining({ item_name: 'Crossbow, light', item_type: 'weapon' }),
      expect.objectContaining({ item_name: 'Lantern, hooded', item_type: 'gear' }),
    ]);
  });

  it('resolves the crossbow bolt bundle to 20 bolts, never a single bolt (#268)', () => {
    expect(resolveEquipmentByName('crossbow bolts (20)')?.name).toBe('Crossbow Bolts (20)');
    expect(resolveEquipmentByName('crossbow bolts (20)')?.id).toBe('bolts-20');
    // The reported case: the Sous Chef's kit must seed the 20-bolt bundle.
    const sousChefKit = [
      'dagger',
      'dagger',
      'dagger',
      'light crossbow',
      'crossbow bolts (20)',
      'arcane focus',
      "explorer's pack",
      'musical instrument',
      'costume',
      'disguise kit',
      "traveler's clothes",
    ];
    const records = transformStarterEquipment(sousChefKit);
    expect(records).toContainEqual(
      expect.objectContaining({ item_name: 'Crossbow Bolts (20)', quantity: 1 }),
    );
    expect(records).not.toContainEqual(expect.objectContaining({ item_name: 'Crossbow bolt' }));
  });

  it('audit: every premade template with a ranged weapon seeds the standard ammo bundle (#268)', () => {
    const migrationRoot = join(process.cwd(), 'supabase/migrations');
    const templateLists = sqlFiles(migrationRoot).flatMap((path) =>
      extractStarterTemplateEquipmentWithKeys(readFileSync(path, 'utf8')),
    );
    expect(templateLists.length).toBeGreaterThan(0);

    // 2014 PHB starting quantities, as seeded bundles (one bundle = the full count).
    const AMMO_BY_WEAPON: Array<{ weapon: RegExp; bundleName: string }> = [
      { weapon: /crossbow/i, bundleName: 'Crossbow Bolts (20)' },
      { weapon: /\b(shortbow|longbow|bow)\b/i, bundleName: 'Arrows (20)' },
      { weapon: /\bsling\b/i, bundleName: 'Sling Bullets (20)' },
      { weapon: /\bblowgun\b/i, bundleName: 'Blowgun Needles (50)' },
    ];
    // Templates with a ranged weapon but no ammo entry at all. Each needs a
    // content-data fix (needs Rob's line); the test fails for any template
    // with a ranged weapon and no ammo that is NOT on this list.
    const KNOWN_AMMO_GAPS = new Set([
      'the-veteran', // Abyssal Descent: light crossbow, no bolts
      'the-pact-bound', // Abyssal Descent: light crossbow, no bolts
      'the-exile', // Abyssal Descent: hand crossbow, no bolts
      'the-lucky-one', // Eternal Feast: shortbow, no arrows
      'the-rigger', // Wings of the Void: light crossbow, no bolts
      'the-driller', // Journey to the Inner World: light crossbow, no bolts
    ]);

    let checked = 0;
    const gapHits: string[] = [];
    for (const { templateKey, equipment } of templateLists) {
      const names = equipment.map((item) => (typeof item === 'string' ? item : item.name));
      const rangedWeapons = names.filter(
        (name) => /crossbow|shortbow|longbow|\bsling\b|\bblowgun\b/i.test(name),
      );
      if (rangedWeapons.length === 0) continue;

      const records = transformStarterEquipment(equipment);
      const recordNames = records.map((r) => r.item_name);
      let hasAmmo = false;
      for (const { weapon, bundleName } of AMMO_BY_WEAPON) {
        if (!rangedWeapons.some((w) => weapon.test(w))) continue;
        const bundle = records.find((r) => r.item_name === bundleName);
        if (bundle) {
          hasAmmo = true;
          checked += 1;
          // Assert quantity, not only presence: one bundle = the PHB count.
          expect(bundle.quantity).toBe(1);
        }
      }
      // A lone single bolt is the #268 bug, never a valid kit.
      expect(recordNames).not.toContain('Crossbow bolt');

      if (!hasAmmo) {
        if (templateKey && KNOWN_AMMO_GAPS.has(templateKey)) {
          gapHits.push(templateKey);
        } else {
          throw new Error(
            `Template ${templateKey ?? '(unknown key)'} has ranged weapon(s) ` +
              `${rangedWeapons.join(', ')} but no ammo bundle. ` +
              `Add the standard bundle or list it in KNOWN_AMMO_GAPS with a content-fix note.`,
          );
        }
      }
    }
    // The Academy seed (sous-chef, gourmand) must be covered by this audit.
    expect(checked).toBeGreaterThanOrEqual(2);
    // Every known gap must still exist; a fixed template drops off the list.
    expect(new Set(gapHits)).toEqual(KNOWN_AMMO_GAPS);
  });

  it('extracts equipment from INSERT ... SELECT seeds', () => {
    const sql = `INSERT INTO public.starter_character_templates (
  template_key,
  equipment
) SELECT
  'the-driller',
  '["light crossbow", "dungeoneer''s pack"]'
FROM public.starter_campaigns
WHERE id = 'x'
ON CONFLICT (template_key) DO UPDATE SET equipment = EXCLUDED.equipment;`;
    expect(extractStarterTemplateEquipment(sql)).toEqual([['light crossbow', "dungeoneer's pack"]]);
  });

  it('resolves every plain-string starter item in every seed except named custom flavor items', () => {
    const seedPaths = sqlFiles(join(process.cwd(), 'supabase/migrations')).filter((path) =>
      /_seed_.*character_templates\.sql$/.test(path),
    );
    // A shape change in the seeds must fail here instead of silently auditing nothing.
    expect(seedPaths.length).toBeGreaterThanOrEqual(5);

    const unresolved = new Set<string>();
    for (const path of seedPaths) {
      const lists = extractStarterTemplateEquipment(readFileSync(path, 'utf8'));
      expect(lists.length, path).toBeGreaterThan(0);
      for (const item of lists.flat()) {
        if (typeof item === 'string' && !resolveEquipmentByName(item)) unresolved.add(item);
      }
    }
    expect([...unresolved].filter((name) => !CUSTOM_FLAVOR_ITEMS.includes(name))).toEqual([]);
  });
});
