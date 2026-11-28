import { describe, expect, it, vi } from 'vitest';

import {
  planRacialBonusBackfill,
  printSummary,
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

/** The premade-copy fixture shared by the FIX round-1 tests below: a pre-cutoff
 * Hill Dwarf whose game_sessions row carries a campaign_id but no
 * starter_campaign_id, so it lands in no exclusion set. The scores are
 * deliberately FINAL (CON 15 = base 13 + 2, WIS 11 = base 10 + 1), so the
 * tests pin the upper-bound choice: a row already at final scores is still
 * counted as needing repair, because the script cannot tell base from final. */
const premadeCopyPlan = (): ReturnType<typeof planRacialBonusBackfill> =>
  planRacialBonusBackfill({
    characters: [
      character({
        id: 'premade-copy-dwarf',
        race: 'Dwarf',
        subrace: 'Hill Dwarf',
        class: 'Fighter',
        created_at: '2026-10-01T12:00:00Z',
      }),
    ],
    stats: [stats('premade-copy-dwarf', { dexterity: 14, constitution: 15, wisdom: 11 })],
    starterCharacterIds: new Set(),
    excludedCampaignCharacterIds: new Set(),
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

  it('counts a premade copy with no starter_campaign_id link as a candidate', () => {
    // A premade copy's game_sessions row carries a campaign_id but no
    // starter_campaign_id, so main() does not put it in starterCharacterIds
    // and the script cannot tell it from a wizard character. It is counted
    // as a candidate (not excluded); excluding such copies by
    // starter_template_id awaits #1744 (migration 0040, not yet landed).
    // The fixture uses final scores (CON 15, WIS 11), so this also pins the
    // upper-bound choice: an already-final row is still counted.
    const { summary } = premadeCopyPlan();
    expect(summary.scanned).toBe(1);
    expect(summary.excludedStarterFlow).toBe(0);
    expect(summary.candidates).toBe(1);
    expect(summary.needingRepair).toBe(1);
  });

  it('reports needingRepair as an upper bound and names the premade-copy caveat', () => {
    // FIX round 1, items 1–2: the method is UI-only and not persisted, so the
    // script cannot tell a base score from a final score — the count is an
    // upper bound. Premade copies without a starter link are counted.
    const { summary } = premadeCopyPlan();
    // NB: read mock.calls BEFORE mockRestore — restore clears the call log.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    printSummary(summary);
    const output = spy.mock.calls.map((args) => String(args[0])).join('\n');
    spy.mockRestore();
    expect(output).toContain(
      'Needing repair: 1 (upper bound — rows already at final scores are counted)',
    );
    expect(output).toContain(
      'premade copies with no starter_campaign_id link are counted as candidates; exclusion by starter_template_id awaits #1744.',
    );
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
