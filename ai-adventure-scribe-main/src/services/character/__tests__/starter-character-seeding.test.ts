import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildStarterCharacterSeed,
  buildStarterSpellSeed,
  transformStarterInventory,
  transformStarterEquipment,
} from '../starter-character-seeding';

const clericTemplate = {
  name: 'The Faithful',
  race: 'Human',
  class: 'Cleric',
  level: 1,
  ability_scores: {
    strength: 14,
    dexterity: 10,
    constitution: 14,
    intelligence: 10,
    wisdom: 18,
    charisma: 12,
  },
  equipment: ['mace', 'scale mail', 'shield', 'an item not in the SRD'],
  skills: ['insight'],
  languages: ['Common'],
  portrait_url: '/images/the-faithful.png',
};

describe('starter-character-seeding', () => {
  it('transforms known equipment and preserves campaign items as trinket records', () => {
    const equipment = transformStarterEquipment([
      'mace',
      'mace',
      { name: 'an item not in the SRD', description: 'A keepsake from the campaign.' },
    ]);

    expect(equipment).toEqual([
      { item_name: 'Mace', item_type: 'weapon', quantity: 2, equipped: true },
      {
        item_name: 'an item not in the SRD',
        item_type: 'trinket',
        quantity: 1,
        equipped: false,
        weight: 0,
        description: 'A keepsake from the campaign.',
      },
    ]);
    expect(
      transformStarterInventory([
        { name: 'an item not in the SRD', description: 'A keepsake from the campaign.' },
      ]),
    ).toEqual([
      {
        name: 'an item not in the SRD',
        item_type: 'trinket',
        quantity: 1,
        weight: 0,
        description: 'A keepsake from the campaign.',
        is_equipped: false,
      },
    ]);
  });

  it('resolves SRD names across case, pluralization, punctuation, and aliases', () => {
    const equipment = transformStarterEquipment([
      'HANDAXES',
      'priest’s pack',
      'lute',
      'holy symbol',
    ]);

    expect(equipment.map((item) => item.item_name)).toEqual([
      'Handaxe',
      "Priest's Pack",
      'Lute',
      'Amulet',
    ]);
    expect(equipment.every((item) => item.item_type !== 'custom')).toBe(true);
  });

  it('grants arrows and the SRD quiver for the quiver-with-arrows bundle', () => {
    expect(transformStarterEquipment(['quiver with 20 arrows'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_name: 'Arrows (20)', item_type: 'gear', quantity: 1 }),
        expect.objectContaining({ item_name: 'Quiver', item_type: 'gear', quantity: 1 }),
      ]),
    );
  });

  it('uses class data for Cleric cantrips and WIS-based preparation', () => {
    const spells = buildStarterSpellSeed(clericTemplate);

    expect(spells.cantrips).toHaveLength(3);
    expect(spells.knownSpells).toHaveLength(5);
    expect(spells.preparedSpells).toEqual(spells.knownSpells);
    expect(spells.cantrips.every((id) => id.length > 0)).toBe(true);
  });

  it('sets both portrait fields and the server-facing spell/equipment fields', () => {
    const seed = buildStarterCharacterSeed(clericTemplate, 'campaign-id');

    expect(seed.image_url).toBe('/images/the-faithful.png');
    expect(seed.avatar_url).toBe('/images/the-faithful.png');
    expect(seed.cantrips).toBeTruthy();
    expect(seed.known_spells).toBeTruthy();
    expect(seed.equipment).toEqual(
      expect.arrayContaining([expect.objectContaining({ item_name: 'Mace', item_type: 'weapon' })]),
    );
  });

  it('computes armour class from the equipment it just built, not 10 + DEX', () => {
    // #1858: The Faithful shipped at AC 10 in Scale Mail and a Shield. Scale Mail 14, DEX +0
    // (capped at +2 for medium armour anyway), shield +2 — the sheet says 16.
    const seed = buildStarterCharacterSeed(clericTemplate, 'campaign-id');
    const stats = seed.stats as { armor_class: number };

    expect(stats.armor_class).toBe(16);
  });

  it('still falls back to 10 + DEX for a template that carries no armour', () => {
    const seed = buildStarterCharacterSeed(
      {
        ...clericTemplate,
        equipment: ['mace'],
        ability_scores: { ...clericTemplate.ability_scores, dexterity: 16 },
      },
      'campaign-id',
    );
    const stats = seed.stats as { armor_class: number };

    expect(stats.armor_class).toBe(13);
  });

  it('keeps both starter creation call sites on the shared helper', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/pages/StarterCharacterSelectionPage.tsx'),
      'utf8',
    );
    const hook = readFileSync(
      resolve(process.cwd(), 'src/features/campaign/hooks/use-character-selection.ts'),
      'utf8',
    );

    expect(page).toMatch(/import \{ seedStarterCharacter \} from .*starter-character-seeding/);
    expect(hook).toMatch(/import \{ seedStarterCharacter \} from .*starter-character-seeding/);
    expect(page.match(/seedStarterCharacter\(/g)).toHaveLength(1);
    expect(hook.match(/seedStarterCharacter\(/g)).toHaveLength(1);
  });
});
