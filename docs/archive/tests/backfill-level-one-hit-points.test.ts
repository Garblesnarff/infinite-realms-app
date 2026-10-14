import { describe, expect, it } from 'vitest';

import {
  formatHitPointBackfillTable,
  parseCliArgs,
  planLevelOneHitPointBackfill,
} from '../scripts/backfill-level-one-hit-points';

describe('backfill-level-one-hit-points', () => {
  it('defaults to dry-run and gates writes behind --apply', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--apply'])).toEqual({ dryRun: false });
  });

  it('restores full HP to the new maximum for a previously full character', () => {
    const result = planLevelOneHitPointBackfill({
      characters: [{ id: 'wizard-1', name: 'Wizard', class: 'Wizard', level: 1 }],
      stats: [
        {
          character_id: 'wizard-1',
          constitution: 14,
          max_hit_points: 10,
          current_hit_points: 10,
        },
      ],
    });

    expect(result.plans[0]).toMatchObject({
      previousMaxHitPoints: 10,
      previousCurrentHitPoints: 10,
      maxHitPoints: 8,
      currentHitPoints: 8,
      changed: true,
    });
  });

  it('preserves a wound while capping it at the new maximum', () => {
    const result = planLevelOneHitPointBackfill({
      characters: [{ id: 'barbarian-1', name: 'Barbarian', class: 'Barbarian', level: 1 }],
      stats: [
        {
          character_id: 'barbarian-1',
          constitution: 12,
          max_hit_points: 8,
          current_hit_points: 5,
        },
      ],
    });

    expect(result.plans[0]).toMatchObject({
      previousMaxHitPoints: 8,
      previousCurrentHitPoints: 5,
      maxHitPoints: 13,
      currentHitPoints: 5,
      changed: true,
    });
  });

  it('reports unresolved classes without inventing a hit die', () => {
    const result = planLevelOneHitPointBackfill({
      characters: [{ id: 'unknown-1', name: 'Unknown', class: 'Mystery', level: 1 }],
      stats: [
        {
          character_id: 'unknown-1',
          constitution: 10,
          max_hit_points: 8,
          current_hit_points: 8,
        },
      ],
    });

    expect(result.plans).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('cannot be resolved');
  });

  it('prints an old-to-new operator table', () => {
    const plan = planLevelOneHitPointBackfill({
      characters: [{ id: 'wizard-1', name: 'Wizard', class: 'Wizard', level: 1 }],
      stats: [
        {
          character_id: 'wizard-1',
          constitution: 14,
          max_hit_points: 10,
          current_hit_points: 10,
        },
      ],
    });

    expect(formatHitPointBackfillTable(plan)).toContain('10/10 | 8/8');
  });
});
