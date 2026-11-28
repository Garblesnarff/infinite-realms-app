import { describe, expect, it } from 'vitest';

import {
  buildRaceBonusLookup,
  parseCliArgs,
  planRow,
  RACIAL_BONUS_FIX_CUTOFF_ISO,
  type BackfillCharacterRow,
  type BackfillStatsRow,
} from '../scripts/backfill-racial-ability-bonuses';

/**
 * #253: committed checks for the dry-run racial-bonus backfill counter.
 *
 * The bonus lookup is built from the real `src/data/races` data
 * (buildRaceBonusLookup), so these tests pin the script to what the wizard
 * actually offers — no copied bonus fixture. Character/stats rows are shaped
 * exactly as the script's Supabase selects return them. The Hill Dwarf HP
 * expectation follows the server's level-1 formula (#620,
 * shared/__tests__/level-1-hit-points.test.ts): a level-1 Hill Dwarf Fighter
 * with CON 15 has 13 HP (d10 + CON modifier +2 + Dwarven Toughness +1).
 */

const stats = (
  characterId: string,
  scores: Partial<Record<string, number>>,
  extra: Partial<BackfillStatsRow> = {},
): BackfillStatsRow => ({
  character_id: characterId,
  strength: scores.strength ?? 10,
  dexterity: scores.dexterity ?? 10,
  constitution: scores.constitution ?? 10,
  intelligence: scores.intelligence ?? 10,
  wisdom: scores.wisdom ?? 10,
  charisma: scores.charisma ?? 10,
  armor_class: extra.armor_class ?? 10,
  max_hit_points: extra.max_hit_points ?? 10,
  current_hit_points: extra.current_hit_points ?? 10,
});

const character = (
  overrides: Partial<BackfillCharacterRow> & { id: string },
): BackfillCharacterRow => ({
  race: null,
  subrace: null,
  class: null,
  level: 1,
  created_at: '2026-10-01T12:00:00Z',
  ...overrides,
});

describe('backfill-racial-ability-bonuses', () => {
  it('pins the #250 merge as the pre/post-fix cutoff', () => {
    expect(RACIAL_BONUS_FIX_CUTOFF_ISO).toBe('2026-10-11T08:29:14Z');
  });

  it('defaults to dry-run with no write path: --apply is an unknown option', () => {
    expect(parseCliArgs([])).toEqual({ excludedCampaignIds: [] });
    // There is no --dry-run flag because dry-run is the only mode; likewise
    // --apply does not exist — the script cannot write by construction.
    expect(() => parseCliArgs(['--dry-run'])).toThrow('Unknown option: --dry-run');
    expect(() => parseCliArgs(['--apply'])).toThrow('Unknown option: --apply');
    expect(() => parseCliArgs(['--bogus'])).toThrow('Unknown option: --bogus');
  });

  it('collects --exclude-campaign ids and rejects a missing id', () => {
    expect(
      parseCliArgs(['--exclude-campaign', 'campaign-a', '--exclude-campaign', 'campaign-b']),
    ).toEqual({ excludedCampaignIds: ['campaign-a', 'campaign-b'] });
    expect(() => parseCliArgs(['--exclude-campaign'])).toThrow('--exclude-campaign needs an id');
  });

  it('builds the bonus lookup from the real race data', () => {
    // Full-map equality: a spurious extra bonus must fail, not just a missing one.
    const bonusMap = (over: Partial<Record<string, number>>): Record<string, number> => ({
      strength: 0,
      dexterity: 0,
      constitution: 0,
      intelligence: 0,
      wisdom: 0,
      charisma: 0,
      ...over,
    });
    const lookup = buildRaceBonusLookup();
    const dwarf = lookup.get('dwarf');
    expect(dwarf?.bonuses).toEqual(bonusMap({ constitution: 2 }));
    expect(dwarf?.subraces.get('hill dwarf')?.bonuses).toEqual(bonusMap({ wisdom: 1 }));
    expect(dwarf?.subraces.get('hill dwarf')?.toughness).toBe(true);
    expect(dwarf?.subraces.get('mountain dwarf')?.bonuses).toEqual(bonusMap({ strength: 2 }));
    const gnome = lookup.get('gnome');
    expect(gnome?.bonuses).toEqual(bonusMap({ intelligence: 2 }));
    expect(gnome?.subraces.get('rock gnome')?.bonuses).toEqual(bonusMap({ constitution: 1 }));
    expect(lookup.get('half-orc')?.bonuses).toEqual(bonusMap({ strength: 2, constitution: 1 }));
    const elf = lookup.get('elf');
    expect(elf?.bonuses).toEqual(bonusMap({ dexterity: 2 }));
    expect(elf?.subraces.get('wood elf')?.bonuses).toEqual(bonusMap({ wisdom: 1 }));
    // Choices that were never persisted: these rows need manual review.
    expect(lookup.get('half-elf')?.hasChoices).toBe(true);
    expect(lookup.get('human')?.subraces.get('variant human')?.hasChoices).toBe(true);
  });

  it('repairs a pre-fix Hill Dwarf Fighter (level-1 HP 13, unarmoured AC 12)', () => {
    const lookup = buildRaceBonusLookup();
    const verdict = planRow(
      character({ id: 'dwarf-1', race: 'Dwarf', subrace: 'Hill Dwarf', class: 'Fighter' }),
      stats(
        'dwarf-1',
        { strength: 12, dexterity: 14, constitution: 13, wisdom: 10 },
        { armor_class: 12, max_hit_points: 12 },
      ),
      lookup,
    );
    expect(verdict.kind).toBe('needsRepair');
    if (verdict.kind !== 'needsRepair') return;
    expect(verdict.plan.newScores).toMatchObject({ constitution: 15, wisdom: 11 });
    expect(verdict.plan.oldScores).toMatchObject({ constitution: 13, wisdom: 10 });
    expect(verdict.plan.oldArmorClass).toBe(12);
    expect(verdict.plan.newArmorClass).toBe(12);
    expect(verdict.plan.oldMaxHitPoints).toBe(12);
    expect(verdict.plan.newMaxHitPoints).toBe(13);
    expect(verdict.plan.toughnessApplied).toBe(true);
  });

  it('repairs Rock Gnome and Half-Orc fixed bonuses', () => {
    const lookup = buildRaceBonusLookup();
    const gnome = planRow(
      character({ id: 'gnome-1', race: 'Gnome', subrace: 'Rock Gnome', class: 'Wizard' }),
      stats('gnome-1', { intelligence: 15, constitution: 12 }),
      lookup,
    );
    expect(gnome.kind).toBe('needsRepair');
    if (gnome.kind === 'needsRepair') {
      expect(gnome.plan.newScores).toMatchObject({ intelligence: 17, constitution: 13 });
      expect(gnome.plan.newMaxHitPoints).toBe(6 + 1); // d6 + CON modifier (+1)
    }
    const orc = planRow(
      character({ id: 'orc-1', race: 'Half-Orc', class: 'Barbarian' }),
      stats('orc-1', { strength: 16, constitution: 14 }),
      lookup,
    );
    expect(orc.kind).toBe('needsRepair');
    if (orc.kind === 'needsRepair') {
      expect(orc.plan.newScores).toMatchObject({ strength: 18, constitution: 15 });
    }
  });

  it('sends Half-Elf and Variant Human rows to manual review', () => {
    const lookup = buildRaceBonusLookup();
    expect(
      planRow(
        character({ id: 'he-1', race: 'Half-Elf', class: 'Bard' }),
        stats('he-1', { charisma: 16 }),
        lookup,
      ).kind,
    ).toBe('needsManualReview');
    expect(
      planRow(
        character({ id: 'vh-1', race: 'Human', subrace: 'Variant Human', class: 'Fighter' }),
        stats('vh-1', { strength: 16 }),
        lookup,
      ).kind,
    ).toBe('needsManualReview');
  });

  it('calls a 20-capped row already correct', () => {
    const lookup = buildRaceBonusLookup();
    expect(
      planRow(
        character({ id: 'capped-1', race: 'Dwarf', subrace: 'Hill Dwarf', class: 'Fighter' }),
        stats('capped-1', { constitution: 20, wisdom: 20 }),
        lookup,
      ).kind,
    ).toBe('alreadyCorrect');
  });

  it('skips rows it cannot resolve', () => {
    const lookup = buildRaceBonusLookup();
    const base = character({ id: 'u-1', race: 'Dwarf', subrace: 'Hill Dwarf', class: 'Fighter' });
    expect(planRow({ ...base, race: 'Not A Race' }, stats('u-1', {}), lookup).kind).toBe('skipped');
    expect(planRow(base, undefined, lookup).kind).toBe('skipped');
    expect(planRow({ ...base, subrace: 'Not A Subrace' }, stats('u-1', {}), lookup).kind).toBe(
      'skipped',
    );
    expect(planRow(base, { ...stats('u-1', {}), strength: null }, lookup).kind).toBe('skipped');
  });

  it('does not recompute HP past level 1 or for an unknown class', () => {
    const lookup = buildRaceBonusLookup();
    const leveled = planRow(
      character({
        id: 'l2-1',
        race: 'Dwarf',
        subrace: 'Hill Dwarf',
        class: 'Fighter',
        level: 2,
      }),
      stats('l2-1', { constitution: 13, wisdom: 10 }),
      lookup,
    );
    expect(leveled.kind).toBe('needsRepair');
    if (leveled.kind === 'needsRepair') expect(leveled.plan.newMaxHitPoints).toBeNull();
    const unknownClass = planRow(
      character({ id: 'uc-1', race: 'Dwarf', subrace: 'Hill Dwarf', class: 'Not A Class' }),
      stats('uc-1', { constitution: 13, wisdom: 10 }),
      lookup,
    );
    expect(unknownClass.kind).toBe('needsRepair');
    if (unknownClass.kind === 'needsRepair') expect(unknownClass.plan.newMaxHitPoints).toBeNull();
  });
});
