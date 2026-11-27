import { describe, expect, it } from 'vitest';

import {
  planRacialBonusBackfill,
  type BackfillCharacterRow,
  type BackfillStatsRow,
} from '../scripts/backfill-racial-ability-bonuses';

/** Set-level planning for the #253 dry-run counter (row-level checks live in backfill-racial-ability-bonuses.test.ts). */

const stats = (characterId: string, scores: Partial<Record<string, number>>): BackfillStatsRow => ({
  character_id: characterId,
  strength: scores.strength ?? 10,
  dexterity: scores.dexterity ?? 10,
  constitution: scores.constitution ?? 10,
  intelligence: scores.intelligence ?? 10,
  wisdom: scores.wisdom ?? 10,
  charisma: scores.charisma ?? 10,
  armor_class: 10,
  max_hit_points: 10,
  current_hit_points: 10,
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

describe('backfill-racial-ability-bonuses-plan', () => {
  it('plans the candidate set: cutoff, starter-flow, seeded, and null-created_at', () => {
    // [id, race, subrace, class, level, created_at, scores]
    const rows: [
      string,
      string,
      string | null,
      string,
      number,
      string | null,
      Record<string, number>,
    ][] = [
      [
        'pre-dwarf',
        'Dwarf',
        'Hill Dwarf',
        'Fighter',
        1,
        '2026-10-01T12:00:00Z',
        { dexterity: 14, constitution: 13, wisdom: 10 },
      ],
      ['pre-elf', 'Half-Elf', null, 'Bard', 1, '2026-10-05T12:00:00Z', { charisma: 16 }],
      [
        'post-dwarf',
        'Dwarf',
        'Hill Dwarf',
        'Fighter',
        1,
        '2026-10-12T12:00:00Z',
        { dexterity: 14, constitution: 15, wisdom: 11 },
      ],
      [
        'starter-dwarf',
        'Dwarf',
        'Hill Dwarf',
        'Fighter',
        1,
        '2026-10-01T12:00:00Z',
        { dexterity: 14, constitution: 13, wisdom: 10 },
      ],
      [
        'seeded-dwarf',
        'Dwarf',
        'Hill Dwarf',
        'Fighter',
        1,
        '2026-10-01T12:00:00Z',
        { dexterity: 14, constitution: 13, wisdom: 10 },
      ],
      [
        'nodate-dwarf',
        'Dwarf',
        'Hill Dwarf',
        'Fighter',
        1,
        null,
        { dexterity: 14, constitution: 13, wisdom: 10 },
      ],
      [
        'leveled-dwarf',
        'Dwarf',
        'Hill Dwarf',
        'Fighter',
        2,
        '2026-10-01T12:00:00Z',
        { dexterity: 14, constitution: 13, wisdom: 10 },
      ],
      ['unknown-race', 'Not A Race', null, 'Fighter', 1, '2026-10-01T12:00:00Z', {}],
    ];
    const { verdicts, summary } = planRacialBonusBackfill({
      characters: rows.map(([id, race, subrace, cls, level, created_at]) =>
        character({ id, race, subrace, class: cls, level, created_at }),
      ),
      stats: rows.map(([id, , , , , , scores]) => stats(id, scores)),
      starterCharacterIds: new Set(['starter-dwarf']),
      excludedCampaignCharacterIds: new Set(['seeded-dwarf']),
    });
    expect(summary.scanned).toBe(8);
    expect(summary.excludedStarterFlow).toBe(1);
    expect(summary.excludedSeededCampaign).toBe(1);
    expect(summary.candidates).toBe(5);
    expect(summary.needingRepair).toBe(3); // pre-dwarf + nodate-dwarf + leveled-dwarf
    expect(summary.needsManualReview).toBe(1); // pre-elf
    expect(summary.alreadyCorrect).toBe(0);
    expect(summary.skipped).toBe(1); // unknown-race
    expect(summary.hpNotRecomputable).toBe(1); // leveled-dwarf is past level 1
    expect(summary.byRace.get('Dwarf / Hill Dwarf')).toBe(3);
    expect(verdicts).toHaveLength(5);
  });

  it('excludes the exact cutoff instant, includes unparseable dates, starter wins ties', () => {
    const { summary } = planRacialBonusBackfill({
      characters: [
        character({
          id: 'boundary-dwarf',
          race: 'Dwarf',
          subrace: 'Hill Dwarf',
          class: 'Fighter',
          created_at: '2026-10-11T08:29:14Z',
        }),
        character({
          id: 'garbage-date-dwarf',
          race: 'Dwarf',
          subrace: 'Hill Dwarf',
          class: 'Fighter',
          created_at: 'not-a-date',
        }),
        character({
          id: 'both-dwarf',
          race: 'Dwarf',
          subrace: 'Hill Dwarf',
          class: 'Fighter',
          created_at: '2026-10-01T12:00:00Z',
        }),
      ],
      stats: [
        stats('boundary-dwarf', { dexterity: 14, constitution: 13, wisdom: 10 }),
        stats('garbage-date-dwarf', { dexterity: 14, constitution: 13, wisdom: 10 }),
        stats('both-dwarf', { dexterity: 14, constitution: 13, wisdom: 10 }),
      ],
      starterCharacterIds: new Set(['both-dwarf']),
      excludedCampaignCharacterIds: new Set(['both-dwarf']),
    });
    expect(summary.scanned).toBe(3);
    expect(summary.excludedStarterFlow).toBe(1); // both-dwarf: starter is checked first
    expect(summary.excludedSeededCampaign).toBe(0);
    expect(summary.candidates).toBe(1); // garbage-date-dwarf only; boundary is post-fix
    expect(summary.needingRepair).toBe(1);
  });
});
