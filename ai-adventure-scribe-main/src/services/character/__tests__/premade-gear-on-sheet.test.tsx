/* eslint-disable max-lines */
/**
 * #2531: a freshly seeded premade's weapons, armour and kit reach the in-game character sheet.
 *
 * The Veteran opened with empty ATTACKS, EQUIPMENT and INVENTORY while the engine attacked with
 * its longsword at +5: `loadCharacterWithSpells` (the game page's loader) never asked for the
 * character's equipment, so the sheet view model had no inventory to build its rows from.
 *
 * Every object here comes from the real producer or follows its full output:
 * - the template rows are read from the seed migrations (`readSeededPremadeTemplates`);
 * - the seeded character is `buildStarterCharacterSeed`'s payload;
 * - the `/v1/characters/:id/equipment` rows follow what `CharacterService.create`
 *   (server-bun/src/services/character-service.ts) inserts into `character_equipment` and
 *   `selectEquipment` (issue-1784-data-service.ts) reads back: every column, including the
 *   ones the seeder never sets (`is_magic: false`, `magic_bonus: 0`, `magic_item_rarity`);
 * - the character record follows `mapCharacterToApi` (routes/v1/characters.ts), with the stats
 *   row under `character_stats` the way `normalizeCharacter` puts it.
 * The loader, the view model and the right sheet are the real ones.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readSeededPremadeTemplates } from './seeded-premade-templates';
import { buildStarterCharacterSeed } from '../starter-character-seeding';

import type { SeededPremadeTemplate } from './seeded-premade-templates';
import type { StarterCharacterCreatePayload } from '../starter-character-seeding';
import type { Issue1784EquipmentRow } from '@/services/issue-1784-api';
import type { Character } from '@/types/character';

import { resolveEquipmentByName } from '@/data/equipment/resolver';
import { RightSheet } from '@/features/game-session/components/game/overhaul/RightSheet';
import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';
import { loadCharacterWithSpells } from '@/services/load-character-with-spells';

const { getCharacter, getCharacterEquipment } = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getCharacterEquipment: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter } }));
vi.mock('@/services/issue-1784-api', () => ({ issue1784Api: { getCharacterEquipment } }));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    getCharacterSpells: vi.fn().mockResolvedValue({ cantrips: [], spells: [] }),
  },
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const CHARACTER_ID = 'character-2531';

type SeededRecord = { item_name: string; item_type: string; quantity: number; equipped: boolean };

/** The row `/v1/characters/:id/equipment` returns for a record the seeder sent. */
function persistedEquipmentRow(record: SeededRecord, index: number): Issue1784EquipmentRow {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    character_id: CHARACTER_ID,
    item_name: record.item_name,
    item_type: record.item_type,
    quantity: record.quantity,
    equipped: record.equipped,
    is_magic: false,
    magic_bonus: 0,
    magic_properties: null,
    requires_attunement: false,
    is_attuned: false,
    attunement_requirements: null,
    magic_item_type: null,
    magic_item_rarity: 'common',
    magic_effects: null,
  };
}

/** The `GET /v1/characters/:id` record for a character created from the seed payload. */
function persistedCharacter(seed: StarterCharacterCreatePayload): Record<string, unknown> {
  return {
    id: CHARACTER_ID,
    user_id: 'user-2531',
    name: seed.name,
    race: seed.race,
    subrace: seed.subrace,
    class: seed.class,
    level: seed.level,
    background: seed.background,
    skill_proficiencies: seed.skill_proficiencies,
    languages: seed.languages,
    cantrips: seed.cantrips,
    known_spells: seed.known_spells,
    prepared_spells: seed.prepared_spells,
    ritual_spells: '',
    experience_points: 0,
    character_stats: [seed.stats],
  };
}

function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`missing ${what}`);
  return value;
}

/** Seed the template, persist it the way the server does, and load it the way the game page does. */
async function loadSeeded(template: SeededPremadeTemplate): Promise<{
  seed: StarterCharacterCreatePayload;
  character: Character;
  sheet: ReturnType<typeof buildCharacterSheet>;
}> {
  const seed = buildStarterCharacterSeed(template, template.starter_campaign_id);
  getCharacter.mockResolvedValue(persistedCharacter(seed));
  getCharacterEquipment.mockResolvedValue(
    (seed.equipment as SeededRecord[]).map(persistedEquipmentRow),
  );
  const character = required(await loadCharacterWithSpells(CHARACTER_ID), 'loaded character');
  return { seed, character, sheet: buildCharacterSheet(character) };
}

const templates = readSeededPremadeTemplates();
const veteran = required(
  templates.find((row) => row.template_key === 'the-veteran'),
  'the-veteran template',
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the Veteran opens with its gear on the sheet (#2531)', () => {
  it('lists the longsword at +5 for 1d8+3 slashing, chain mail, shield and kit', async () => {
    const { sheet } = await loadSeeded(veteran);

    expect(sheet.attacks).toContainEqual({
      id: 'Longsword',
      name: 'Longsword',
      bonus: '+5',
      damage: '1d8+3 slashing',
    });
    expect(sheet.attacks.map((attack) => attack.name)).toEqual(['Longsword', 'Crossbow, Light']);
    expect(sheet.equipment.map((item) => item.name)).toEqual(
      expect.arrayContaining(['Chain Mail', 'Shield']),
    );
    expect(sheet.equipment.find((item) => item.name === 'Chain Mail')?.detail).toBe('Armor');
    expect(sheet.inventory.map((item) => item.name)).toEqual([
      "Dungeoneer's Pack",
      'Trophy From Fallen Enemy',
    ]);
    expect(sheet.gearUnavailable).toBe(false);
  });

  it('renders those rows in the right sheet', async () => {
    const { sheet } = await loadSeeded(veteran);

    render(<RightSheet c={sheet} />);

    expect(screen.getByText('1d8+3 slashing').closest('.min-w-0')).toHaveTextContent(
      /Longsword.*1d8\+3 slashing.*\+5/,
    );
    expect(screen.getByText('Chain Mail')).toBeInTheDocument();
    expect(screen.getByText('Shield')).toBeInTheDocument();
    expect(screen.getByText("Dungeoneer's Pack")).toBeInTheDocument();
    expect(screen.queryByText('No weapons')).not.toBeInTheDocument();
  });

  it('loads the character with no inventory when the equipment request fails', async () => {
    const seed = buildStarterCharacterSeed(veteran, veteran.starter_campaign_id);
    getCharacter.mockResolvedValue(persistedCharacter(seed));
    getCharacterEquipment.mockRejectedValue(new Error('equipment 500'));

    const character = required(await loadCharacterWithSpells(CHARACTER_ID), 'loaded character');
    const sheet = buildCharacterSheet(character);

    expect(character.name).toBe('The Veteran');
    expect(character.inventory).toBeUndefined();
    expect(sheet.gearUnavailable).toBe(true);

    render(<RightSheet c={sheet} />);
    expect(screen.getAllByText('Equipment unavailable')).toHaveLength(3);
    expect(screen.queryByText('No weapons')).not.toBeInTheDocument();
  });
});

describe('every seeded premade shows what the seeder gave it', () => {
  it.each(templates.map((row) => [`${row.starter_campaign_id}/${row.template_key}`, row] as const))(
    '%s',
    async (_key, template) => {
      const { seed, sheet } = await loadSeeded(template);
      const records = seed.equipment as SeededRecord[];
      const prettify = (name: string): string =>
        name.replace(/[_-]+/g, ' ').replace(/(^|\s)\w/g, (c) => c.toUpperCase());
      const namesOf = (filter: (record: SeededRecord) => boolean): string[] =>
        records.filter(filter).map((record) => prettify(record.item_name));

      expect(sheet.attacks.map((attack) => attack.name)).toEqual(
        namesOf((record) => record.item_type === 'weapon'),
      );
      expect(sheet.equipment.map((item) => item.name)).toEqual(
        namesOf((record) => record.equipped),
      );
      expect(sheet.inventory.map((item) => item.name)).toEqual(
        namesOf((record) => !record.equipped),
      );
      // Every weapon row carries a real damage line, not a blank.
      expect(sheet.attacks.every((attack) => /^\d+d\d+/.test(attack.damage))).toBe(true);
    },
  );
});

describe('Academy of Arcane Gastronomy premades have real weapon rows', () => {
  const expectations: Record<
    string,
    {
      weaponIds: string[];
      ac: number;
      attacks: Array<{ name: string; bonus: string }>;
    }
  > = {
    'the-apprentice': {
      weaponIds: ['quarterstaff', 'dagger'],
      ac: 11,
      attacks: [
        { name: 'Quarterstaff', bonus: '+1' },
        { name: 'Dagger', bonus: '+3' },
      ],
    },
    'the-kitchen-hand': {
      weaponIds: ['dagger', 'shortbow', 'shortsword'],
      ac: 14,
      attacks: [
        { name: 'Dagger', bonus: '+5' },
        { name: 'Shortbow', bonus: '+5' },
        { name: 'Shortsword', bonus: '+5' },
      ],
    },
    'the-gourmand': {
      weaponIds: ['handaxe', 'longsword', 'crossbow-light'],
      ac: 18,
      attacks: [
        { name: 'Handaxe', bonus: '+5' },
        { name: 'Longsword', bonus: '+5' },
        { name: 'Crossbow, Light', bonus: '+3' },
      ],
    },
    'the-herbalist': {
      weaponIds: ['scimitar', 'dagger'],
      ac: 14,
      attacks: [
        { name: 'Scimitar', bonus: '+3' },
        { name: 'Dagger', bonus: '+3' },
      ],
    },
    'the-sous-chef': {
      weaponIds: ['dagger', 'crossbow-light'],
      ac: 11,
      attacks: [
        { name: 'Dagger', bonus: '+3' },
        { name: 'Crossbow, Light', bonus: '+3' },
      ],
    },
  };

  const academyTemplates = templates.filter(
    (template) => template.starter_campaign_id === 'academy-of-arcane-gastronomy',
  );

  it('includes all five production Academy templates with catalog-resolvable weapons', () => {
    expect(academyTemplates).toHaveLength(5);
    expect(
      academyTemplates.map(({ template_key, class: className, background }) => ({
        template_key,
        class: className,
        background,
      })),
    ).toEqual([
      { template_key: 'the-apprentice', class: 'Wizard', background: 'Sage' },
      { template_key: 'the-kitchen-hand', class: 'Rogue', background: 'Urchin' },
      { template_key: 'the-gourmand', class: 'Fighter', background: 'Folk Hero' },
      { template_key: 'the-herbalist', class: 'Druid', background: 'Hermit' },
      { template_key: 'the-sous-chef', class: 'Sorcerer', background: 'Entertainer' },
    ]);
    for (const template of academyTemplates) {
      const expected = expectations[template.template_key];
      const weapons = template.equipment
        .map((name) => resolveEquipmentByName(name))
        .filter((equipment) => equipment?.category === 'weapon');
      expect([...new Set(weapons.map((weapon) => weapon?.id))], template.template_key).toEqual(
        expected.weaponIds,
      );
    }
  });

  it.each(academyTemplates.map((template) => [template.template_key, template] as const))(
    '%s renders its resolved weapon attack rows on the sheet',
    async (_key, template) => {
      const { sheet } = await loadSeeded(template);
      const expected = expectations[template.template_key];

      expect(sheet.ac, template.template_key).toBe(expected.ac);
      expect(
        sheet.attacks.map(({ name, bonus }) => ({ name, bonus })),
        template.template_key,
      ).toEqual(expected.attacks);
      expect(sheet.attacks.every((attack) => /^\d+d\d+/.test(attack.damage))).toBe(true);
      render(<RightSheet c={sheet} />);
      for (const attack of expected.attacks) {
        expect(screen.getAllByText(attack.name).length).toBeGreaterThan(0);
      }
    },
  );
});

describe('a premade whose template lists no weapons', () => {
  const unarmed: SeededPremadeTemplate = {
    ...veteran,
    equipment: ['chain mail', 'shield', "dungeoneer's pack"],
  };

  it('shows an explicit empty state in Attacks, not a blank section', async () => {
    const { sheet } = await loadSeeded(unarmed);

    expect(sheet.attacks).toEqual([]);
    expect(sheet.gearUnavailable).toBe(false);

    render(<RightSheet c={sheet} />);

    expect(screen.getByText('No weapons')).toBeInTheDocument();
    expect(screen.getByText('Chain Mail')).toBeInTheDocument();
    expect(screen.queryByText('Equipment unavailable')).not.toBeInTheDocument();
  });

  it('says Nothing equipped / Nothing carried / None for the other empty sections', async () => {
    const { sheet } = await loadSeeded({ ...veteran, equipment: [] });

    render(<RightSheet c={sheet} />);

    expect(screen.getByText('No weapons')).toBeInTheDocument();
    expect(screen.getByText('Nothing equipped')).toBeInTheDocument();
    expect(screen.getByText('Nothing carried')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();
  });
});

describe('a character made in the wizard', () => {
  // The wizard stores no item type; the API and the server default it to 'equipment'
  // (transformEquipmentForStorage, CharacterService.create), and the item name is the catalog id.
  it('still lists its longsword as an attack, and carrying kit does not slow the sheet', async () => {
    const seed = buildStarterCharacterSeed(veteran, veteran.starter_campaign_id);
    getCharacter.mockResolvedValue(persistedCharacter(seed));
    getCharacterEquipment.mockResolvedValue(
      [
        { item_name: 'longsword', item_type: 'equipment', quantity: 1, equipped: true },
        { item_name: 'chain-mail', item_type: 'equipment', quantity: 1, equipped: true },
        { item_name: 'arrows', item_type: 'equipment', quantity: 300, equipped: false },
      ].map(persistedEquipmentRow),
    );

    const character = required(await loadCharacterWithSpells(CHARACTER_ID), 'loaded character');
    const sheet = buildCharacterSheet(character);

    expect(sheet.attacks.map((attack) => attack.name)).toEqual(['Longsword']);
    expect(sheet.speed).toBe(30);
  });
});
