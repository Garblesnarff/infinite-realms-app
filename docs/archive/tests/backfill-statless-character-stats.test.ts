import { describe, expect, it } from 'vitest';

import {
  STATLESS_CHARACTER_IDS,
  assignClassStandardArray,
  formatStatlessRepairPlan,
  parseCliArgs,
  planStatlessCharacterRepair,
  seedRaceClassDefaults,
  unarmoredArmorClass,
} from '../scripts/backfill-statless-character-stats';

const SEEKER_ID = STATLESS_CHARACTER_IDS[0];
const REVELER_ID = STATLESS_CHARACTER_IDS[1];

describe('backfill-statless-character-stats', () => {
  it('defaults to dry-run and gates writes behind --apply', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--apply'])).toEqual({ dryRun: false });
  });

  it('rejects unknown flags so a mistyped apply cannot write', () => {
    expect(() => parseCliArgs(['--force'])).toThrow(/Unknown option/);
  });

  it('seeds a Catfolk Monk from race and class defaults', () => {
    const plan = seedRaceClassDefaults({
      id: SEEKER_ID,
      name: 'The Seeker',
      race: 'Catfolk',
      subrace: null,
      class: 'Monk',
      level: 1,
    });

    expect(plan.abilityScores).toEqual({
      strength: 12,
      dexterity: 17,
      constitution: 13,
      intelligence: 10,
      wisdom: 14,
      charisma: 9,
    });
    expect(plan.armorClass).toBe(15);
    expect(plan.maxHitPoints).toBe(9);
    expect(plan.currentHitPoints).toBe(9);
    expect(plan.speed).toBe(30);
    expect(plan.changed).toBe(true);
  });

  it('seeds an Elf Barbarian from race and class defaults', () => {
    const plan = seedRaceClassDefaults({
      id: REVELER_ID,
      name: 'The Reveler',
      race: 'Elf',
      subrace: null,
      class: 'Barbarian',
      level: 1,
    });

    expect(plan.abilityScores).toEqual({
      strength: 15,
      dexterity: 15,
      constitution: 14,
      intelligence: 8,
      wisdom: 12,
      charisma: 10,
    });
    expect(plan.armorClass).toBe(14);
    expect(plan.maxHitPoints).toBe(14);
    expect(plan.currentHitPoints).toBe(14);
  });

  it('applies a High Elf Intelligence increase on top of the Elf racial bonus', () => {
    const plan = seedRaceClassDefaults({
      id: REVELER_ID,
      name: 'The Reveler',
      race: 'Elf',
      subrace: 'High Elf',
      class: 'Barbarian',
      level: 1,
    });

    expect(plan.abilityScores.intelligence).toBe(9);
    expect(plan.abilityScores.dexterity).toBe(15);
  });

  it('uses unarmored defense for monk and barbarian, 10+DEX otherwise', () => {
    const monk = assignClassStandardArray('monk');
    const fighter = assignClassStandardArray('fighter');
    expect(unarmoredArmorClass('monk', monk)).toBe(10 + 2 + 2);
    expect(unarmoredArmorClass('fighter', fighter)).toBe(10 + 1);
  });

  it('plans inserts for the two named ids and skips an existing stats row', () => {
    const result = planStatlessCharacterRepair({
      characters: [
        {
          id: SEEKER_ID,
          name: 'The Seeker',
          race: 'Catfolk',
          subrace: null,
          class: 'Monk',
          level: 1,
        },
        {
          id: REVELER_ID,
          name: 'The Reveler',
          race: 'Elf',
          subrace: null,
          class: 'Barbarian',
          level: 1,
        },
      ],
      stats: [{ character_id: REVELER_ID }],
    });

    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]?.characterId).toBe(SEEKER_ID);
    expect(result.skipped).toEqual([
      {
        characterId: REVELER_ID,
        characterName: 'The Reveler',
        reason: 'character_stats row already exists; leaving it untouched',
      },
    ]);
  });

  it('skips a missing character and an unresolvable class without inventing scores', () => {
    const result = planStatlessCharacterRepair({
      characters: [
        {
          id: SEEKER_ID,
          name: 'The Seeker',
          race: 'Catfolk',
          subrace: null,
          class: 'Mystery',
          level: 1,
        },
      ],
      stats: [],
    });

    expect(result.plans).toHaveLength(0);
    expect(result.skipped.map((row) => row.reason)).toEqual([
      expect.stringContaining('cannot be resolved'),
      'character row was not found',
    ]);
  });

  it('prints the seeded row for operator review', () => {
    const plan = seedRaceClassDefaults({
      id: SEEKER_ID,
      name: 'The Seeker',
      race: 'Catfolk',
      subrace: null,
      class: 'Monk',
      level: 1,
    });

    expect(formatStatlessRepairPlan(plan)).toContain('The Seeker');
    expect(formatStatlessRepairPlan(plan)).toContain('DEX 17');
    expect(formatStatlessRepairPlan(plan)).toContain('AC 15');
    expect(formatStatlessRepairPlan(plan)).toContain('HP 9/9');
  });
});
