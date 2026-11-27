import { describe, expect, mock, test } from 'bun:test';

import { campaigns, gameSessions, starterCampaigns } from '../../../../../db/schema/index.js';
import { describeOutcome } from '../combat-check-outcome-text.js';
import { resolveDcCheck } from '../combat-check-rules.js';

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

const resolution = resolveDcCheck({
  kind: 'persuade',
  actorProfile: { scores: { cha: 12 }, level: 1 },
  actorD20: 18,
  dc: 15,
  opposedByLabel: 'DC 15',
  roll: () => 1,
});

describe('check fact target numbers (#157)', () => {
  test('Easy campaign with show_target_numbers:false sends no "against DC" in dmFact', async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Easy', rulesConfig: { show_target_numbers: false } },
      null,
    );
    const showTargetNumbers = await showTargetNumbersForSession('s1');
    expect(showTargetNumbers).toBe(false);
    const { dmFact } = describeOutcome({
      resolution,
      consequence: '',
      actorLabel: 'Rook',
      targetLabel: 'Goblin',
      parleyDc: 15,
      showTargetNumbers,
    });
    expect(dmFact).not.toContain('against DC');
    expect(dmFact).not.toMatch(/DC \d/);
  });
});
