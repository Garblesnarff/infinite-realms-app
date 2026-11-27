import { describe, expect, mock, test } from 'bun:test';

import { campaigns, gameSessions, starterCampaigns } from '../../../../../db/schema/index.js';
import { showTargetNumbersFor } from '../../../../../shared/show-target-numbers.js';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';

type Row = Record<string, unknown>;

const sessionHolder: { value: Row } = { value: {} };
const campaignHolder: { value: Row | null } = { value: null };
const starterHolder: { value: Row | null } = { value: null };

class Chain {
  private table: unknown = null;
  from(table: unknown): this {
    this.table = table;
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  then(resolve: (value: unknown) => void): void {
    if (this.table === gameSessions) {
      resolve([sessionHolder.value]);
    } else if (this.table === campaigns) {
      resolve(campaignHolder.value ? [campaignHolder.value] : []);
    } else if (this.table === starterCampaigns) {
      resolve(starterHolder.value ? [starterHolder.value] : []);
    } else {
      resolve([]);
    }
  }
}

const fakeDb = { select: () => new Chain() };
mock.module('../../../../../db/client', () => ({ db: fakeDb }));
mock.module('../../../lib/logger.js', () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

const { showTargetNumbersForSession } = await import('../session-target-numbers.js');

function seed(session: Row, campaign: Row | null, starter: Row | null): void {
  sessionHolder.value = session;
  campaignHolder.value = campaign;
  starterHolder.value = starter;
}

describe('showTargetNumbersForSession (#157)', () => {
  test("campaign 'Medium' with rulesConfig {show_target_numbers:false} -> false", async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Medium', rulesConfig: { show_target_numbers: false } },
      null,
    );
    expect(await showTargetNumbersForSession('s1')).toBe(false);
  });

  test("campaign 'Hard' with rulesConfig {show_target_numbers:true} -> true", async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Hard', rulesConfig: { show_target_numbers: true } },
      null,
    );
    expect(await showTargetNumbersForSession('s1')).toBe(true);
  });

  test("campaign 'Hard' no rulesConfig -> false", async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Hard', rulesConfig: null },
      null,
    );
    expect(await showTargetNumbersForSession('s1')).toBe(false);
  });

  test("starter campaign 'Hard' -> false", async () => {
    seed({ id: 's1', campaignId: null, starterCampaignId: 'st1' }, null, {
      id: 'st1',
      difficulty: 'Hard',
    });
    expect(await showTargetNumbersForSession('s1')).toBe(false);
  });
});

describe('showTargetNumbersFor: the one rule both sides use (#157)', () => {
  test('a saved boolean wins over difficulty; anything else falls back to the difficulty default', () => {
    expect(showTargetNumbersFor({ show_target_numbers: true }, 'hard')).toBe(true);
    expect(showTargetNumbersFor({ show_target_numbers: false }, 'medium')).toBe(false);
    expect(showTargetNumbersFor({}, 'hard')).toBe(false);
    expect(showTargetNumbersFor({ show_target_numbers: 'no' }, 'easy')).toBe(true);
    expect(showTargetNumbersFor(null, 'deadly')).toBe(false);
    expect(showTargetNumbersFor([], 'medium')).toBe(true);
    expect(showTargetNumbersFor(undefined, undefined)).toBe(true);
  });
});
