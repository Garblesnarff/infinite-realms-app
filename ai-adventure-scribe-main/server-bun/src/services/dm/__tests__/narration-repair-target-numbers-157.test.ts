import { describe, expect, mock, test } from 'bun:test';

import {
  campaigns,
  dialogueHistory,
  gameSessions,
  starterCampaigns,
} from '../../../../../db/schema/index.js';

process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';

type Row = Record<string, unknown>;

const sessionHolder: { value: Row } = { value: {} };
const campaignHolder: { value: Row | null } = { value: null };
const starterHolder: { value: Row | null } = { value: null };
const combatLogHolder: { value: unknown[] } = { value: [] };

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
      resolve([
        {
          ...sessionHolder.value,
          state: { combatLog: combatLogHolder.value },
          sessionState: { combatLog: combatLogHolder.value },
        },
      ]);
    } else if (this.table === campaigns) {
      resolve(campaignHolder.value ? [campaignHolder.value] : []);
    } else if (this.table === starterCampaigns) {
      resolve(starterHolder.value ? [starterHolder.value] : []);
    } else if (this.table === dialogueHistory) {
      resolve([]);
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

const { repairNarrationContradiction } = await import('../narration-outcome.js');

function seed(session: Row, campaign: Row | null, starter: Row | null, combatLog: unknown[]): void {
  sessionHolder.value = session;
  campaignHolder.value = campaign;
  starterHolder.value = starter;
  combatLogHolder.value = combatLog;
}

const combatLog = [
  {
    entry: {
      kind: 'roll_result',
      payload: {
        success: false,
        total: 7,
        dc: 14,
        description: 'Dexterity save',
        requestType: 'saving_throw',
      },
    },
    timestamp: new Date().toISOString(),
  },
];

describe('repairNarrationContradiction target numbers (#157)', () => {
  test('setting off (Hard campaign) + DM claims success on failed DC 14 save -> failed (7)., no vs DC', async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Hard', rulesConfig: null },
      null,
      combatLog,
    );
    const text = 'You succeed in making the Dexterity save.';
    const result = await repairNarrationContradiction({ sessionId: 's1', text });
    expect(result).not.toBeNull();
    expect(result ?? '').toContain('failed (7).');
    expect(result ?? '').not.toContain('vs DC');
  });

  test('setting off (rules_config show_target_numbers false) -> failed (7)., no vs DC', async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Medium', rulesConfig: { show_target_numbers: false } },
      null,
      combatLog,
    );
    const text = 'You succeed in making the Dexterity save.';
    const result = await repairNarrationContradiction({ sessionId: 's1', text });
    expect(result).not.toBeNull();
    expect(result ?? '').toContain('failed (7).');
    expect(result ?? '').not.toContain('vs DC');
  });

  test('setting on (Medium, no rules) -> contains (7 vs DC 14)', async () => {
    seed(
      { id: 's1', campaignId: 'c1', starterCampaignId: null },
      { id: 'c1', difficultyLevel: 'Medium', rulesConfig: null },
      null,
      combatLog,
    );
    const text = 'You succeed in making the Dexterity save.';
    const result = await repairNarrationContradiction({ sessionId: 's1', text });
    expect(result).not.toBeNull();
    expect(result ?? '').toContain('(7 vs DC 14)');
  });
});
