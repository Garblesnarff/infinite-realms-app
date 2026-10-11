/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2540 and #2541: the engine's weapon proficiency comes from `shared/weapon-proficiency.ts`,
 * the same rule the character sheet reads, and it is the SRD 5.1 one — a Wizard is not
 * proficient with a mace, a High Elf Wizard is proficient with a longsword.
 *
 * These go through `listEquippedWeaponProfiles`, the real producer, with the database stubbed:
 * the rows are what `character-service` inserts for a seeded character (item_name is the SRD
 * display name), and the character row carries the stored `race`/`subrace`/`class` text columns.
 */
import { describe, expect, it, mock } from 'bun:test';

const dbPath = import.meta.resolve('../../../../../db/client');

let equippedRows: unknown[][] = [];
let selectCall = 0;
let characterRow: unknown = null;

function query(rows: unknown[]) {
  const promise = Promise.resolve(rows);
  const chain: any = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    for: () => promise,
    then: (resolve: any, reject: any) => promise.then(resolve, reject),
  };
  return chain;
}

const fakeDb: any = {
  select: () => query(equippedRows[selectCall++] ?? []),
  query: { characters: { findFirst: async () => characterRow } },
};

mock.module(dbPath, () => ({ db: fakeDb }));

const { listEquippedWeaponProfiles } = await import('../data-access.js');

/** One equipped `inventory_items` row, in the columns `listEquippedWeaponProfiles` reads. */
const equipped = (name: string) => ({
  id: `00000000-0000-4000-8000-00000000000${name.length}`,
  name,
  itemType: 'weapon',
  properties: null,
  createdAt: null,
});

async function proficiencyFor(
  character: { class: string; race: string; subrace: string },
  weaponNames: string[],
): Promise<Record<string, boolean>> {
  selectCall = 0;
  equippedRows = [weaponNames.map(equipped), []];
  characterRow = character;
  const profiles = await listEquippedWeaponProfiles({ characterId: 'character-2540' });
  return Object.fromEntries(profiles.map((profile) => [profile.name, profile.proficient]));
}

const HUMAN = { class: 'Fighter', race: 'Human', subrace: '' };

describe('engine weapon proficiency follows the SRD class lists (#2541)', () => {
  it('gives a Wizard the SRD list, so no mace', async () => {
    const proficient = await proficiencyFor({ class: 'Wizard', race: 'Human', subrace: '' }, [
      'Quarterstaff',
      'Mace',
      'Longsword',
    ]);

    expect(proficient).toEqual({ Quarterstaff: true, Mace: false, Longsword: false });
  });

  it('gives a Fighter every martial weapon and every simple one', async () => {
    const proficient = await proficiencyFor(HUMAN, ['Battleaxe', 'Greatsword', 'Dagger']);

    expect(proficient).toEqual({ Battleaxe: true, Greatsword: true, Dagger: true });
  });

  it('gives a Druid its named list, scimitar included', async () => {
    const proficient = await proficiencyFor({ class: 'Druid', race: 'Human', subrace: '' }, [
      'Scimitar',
      'Club',
      'Longsword',
    ]);

    expect(proficient).toEqual({ Scimitar: true, Club: true, Longsword: false });
  });
});

describe('engine weapon proficiency reads the character record (#2540)', () => {
  it('gives a High Elf Wizard a longsword', async () => {
    const proficient = await proficiencyFor({ class: 'Wizard', race: 'Elf', subrace: 'High Elf' }, [
      'Longsword',
      'Mace',
    ]);

    expect(proficient).toEqual({ Longsword: true, Mace: false });
  });

  it('gives a Dwarf Wizard the dwarf training weapons', async () => {
    const proficient = await proficiencyFor(
      { class: 'Wizard', race: 'Dwarf', subrace: 'Hill Dwarf' },
      ['Warhammer', 'Mace'],
    );

    expect(proficient).toEqual({ Warhammer: true, Mace: false });
  });

  it('leaves an unknown weapon without proficiency', async () => {
    const proficient = await proficiencyFor(HUMAN, ['Sword of Certain Doom']);

    expect(proficient).toEqual({ 'Sword of Certain Doom': false });
  });
});

describe('engine weapon proficiency resolves magic weapons through their base weapon (#155)', () => {
  it('gives a Fighter a Sun Blade (baseWeaponId: longsword, martial)', async () => {
    const proficient = await proficiencyFor(HUMAN, ['Sun Blade']);

    expect(proficient).toEqual({ 'Sun Blade': true });
  });

  it('gives a Monk a Sun Blade (alternate base: shortsword — 2014 DMG "shortswords or longswords")', async () => {
    // The Monk has no longsword proficiency: this passes only through the
    // shortsword alternate on the sun-blade row.
    const proficient = await proficiencyFor({ class: 'Monk', race: 'Human', subrace: '' }, [
      'Sun Blade',
    ]);

    expect(proficient).toEqual({ 'Sun Blade': true });
  });

  it('denies a Wizard a Mace of Disruption (mace is not on the wizard list)', async () => {
    const proficient = await proficiencyFor({ class: 'Wizard', race: 'Human', subrace: '' }, [
      'Mace of Disruption',
    ]);

    expect(proficient).toEqual({ 'Mace of Disruption': false });
  });

  it('gives a Wizard a Dagger of Venom (dagger is on the wizard list)', async () => {
    const proficient = await proficiencyFor({ class: 'Wizard', race: 'Human', subrace: '' }, [
      'Dagger of Venom',
    ]);

    expect(proficient).toEqual({ 'Dagger of Venom': true });
  });

  it('leaves a Flame Tongue without proficiency — "any sword" names no single base weapon', async () => {
    const proficient = await proficiencyFor(HUMAN, ['Flame Tongue']);

    expect(proficient).toEqual({ 'Flame Tongue': false });
  });
});
