/**
 * DM_PACING log-line tests for #1170 (re-scoped 2026-10-27): the pacing
 * budget fires, but nothing visible or logged marks it. The fix logs one
 * line per budget event with the typed-turn number, so Hetzner can count
 * the budget's course from prod logs:
 *   DM_PACING directive turn=45
 *   DM_PACING climax turn=60
 *   DM_PACING ending_required turn=66
 *   DM_PACING engine_ending turn=67
 *
 * The logger and the database are faked via bun's mock.module, so the
 * tests assert on the captured log objects, not on stdout text. The
 * Chain is COUNT-aware: a select whose columns carry a 'count' key
 * resolves to [{ count }] (the typed-turn count), every other select
 * resolves to rows, so the tests can also pin whether the COUNT ran at
 * all (a clock-limit phase never pays for it). Everything else
 * (loadTrackerState, the budget trip, the climax count, the safety net)
 * is the real code under test. Mocked log tests need no ci.yml
 * registration: the server suite auto-discovers *.test.ts.
 */
import { describe, expect, mock, test } from 'bun:test';

import {
  campaignRules,
  dialogueHistory,
  gameSessions,
  sessionTrackers,
} from '../../../../../db/schema/index';

type Logged = Record<string, unknown>;
const captured: Logged[] = [];
const sessionStateHolder: { value: unknown } = { value: {} };
let playerTurnCount = 0;
let countQueries = 0;
const encounterHolder: { value: unknown } = { value: null };
const envelopeHolder: { value: unknown } = { value: {} };
const validEndingHolder: { value: boolean } = { value: false };
const applyEndingHolder: { value: { outcome: string; summary?: string } } = {
  value: { outcome: 'applied', summary: 'engine summary' },
};
const definitionRowsHolder: { value: unknown[] } = {
  value: [
    { condition: 'the Breath Clock reaches 6', metadata: {}, effect: null },
    { condition: 'the Glass Clock reaches 3', metadata: {}, effect: null },
  ],
};
const storedRowsHolder: { value: unknown[] } = {
  value: [{ name: 'Breath', value: 1, limit: 6 }],
};

class Chain {
  private table: unknown = null;
  private joined = false;
  private isCount = false;
  constructor(columns?: unknown) {
    this.isCount =
      !!columns && typeof columns === 'object' && 'count' in (columns as Record<string, unknown>);
  }
  from(table: unknown): this {
    this.table = table;
    return this;
  }
  innerJoin(): this {
    this.joined = true;
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
  for(): this {
    return this;
  }
  set(): this {
    return this;
  }
  values(): { onConflictDoUpdate: () => Promise<void> } {
    return { onConflictDoUpdate: () => Promise.resolve() };
  }
  then(resolve: (value: unknown) => void, reject: (error: unknown) => void): void {
    try {
      if (this.isCount) {
        countQueries += 1;
        resolve([{ count: playerTurnCount }]);
        return;
      }
      resolve(rowsFor(this.table, this.joined));
    } catch (error) {
      reject(error);
    }
  }
}

function rowsFor(table: unknown, joined: boolean): unknown[] {
  if (table === dialogueHistory) return [{ id: 'msg1' }];
  if (table === campaignRules) return definitionRowsHolder.value;
  if (table === sessionTrackers) return storedRowsHolder.value;
  if (table === gameSessions) {
    if (joined) {
      return [
        {
          starterCampaignId: 'camp1',
          sessionState: {},
          campaignLength: 'one-shot',
          currentSceneDescription: 'The Root Stair',
        },
      ];
    }
    return [{ status: 'active', sessionState: sessionStateHolder.value }];
  }
  return [];
}

const fakeTx = {
  select: (columns?: unknown) => new Chain(columns),
  insert: () => new Chain(),
  update: (table: unknown) => new Chain().from(table),
};
const fakeDb = {
  select: (columns?: unknown) => new Chain(columns),
  transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx),
};

mock.module('../../../../../db/client', () => ({ db: fakeDb }));
mock.module('../dm-feature-gate.js', () => ({
  ownedSessionCharacter: async () => ({ id: 'char1' }),
}));
mock.module('../../../lib/logger.js', () => ({
  logger: {
    info: (obj: Logged) => {
      captured.push(obj);
    },
    warn: () => {},
  },
}));
mock.module('../../combat/combat-encounter-service.js', () => ({
  CombatEncounterService: {
    getActiveEncounter: async () => encounterHolder.value,
  },
}));
mock.module('../story-ending.js', () => ({
  applyStoryEnding: async () => applyEndingHolder.value,
  validCampaignEnding: () => validEndingHolder.value,
}));
mock.module('../dm-response-schema.js', () => ({
  parseLlmEnvelope: () => envelopeHolder.value,
}));

function reset(): void {
  captured.length = 0;
  sessionStateHolder.value = {};
  playerTurnCount = 0;
  countQueries = 0;
  encounterHolder.value = null;
  envelopeHolder.value = {};
  validEndingHolder.value = false;
  applyEndingHolder.value = { outcome: 'applied', summary: 'engine summary' };
  definitionRowsHolder.value = [
    { condition: 'the Breath Clock reaches 6', metadata: {}, effect: null },
    { condition: 'the Glass Clock reaches 3', metadata: {}, effect: null },
  ];
  storedRowsHolder.value = [{ name: 'Breath', value: 1, limit: 6 }];
}

const pacingLogs = (event: string) =>
  captured.filter((log) => typeof log.msg === 'string' && log.msg.startsWith(`DM_PACING ${event}`));

describe('DM_PACING (#1170)', () => {
  test('the directive logs its turn when the pacing line renders at 45', async () => {
    reset();
    playerTurnCount = 45;
    // The Last Toll shape: Wall 2/6, no phase, not in combat.
    definitionRowsHolder.value = [{ condition: 'the Wall Clock reaches 6', metadata: {}, effect: null }];
    storedRowsHolder.value = [{ name: 'Wall', value: 2, limit: 6 }];
    const { loadStoryTrackerDirective } = await import('../story-tracker.js');
    const loaded = await loadStoryTrackerDirective({ sessionId: 's1', userId: 'u1' });
    expect(loaded.text).toContain('turn 45 of 60');
    expect(loaded.text).toContain('the Wall Clock');
    const logs = pacingLogs('directive');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.msg).toBe('DM_PACING directive turn=45');
    expect(logs[0]!.sessionId).toBe('s1');
    expect(pacingLogs('climax')).toHaveLength(0);
  });

  test('below the directive turn nothing logs', async () => {
    reset();
    playerTurnCount = 44;
    const { loadStoryTrackerDirective } = await import('../story-tracker.js');
    const loaded = await loadStoryTrackerDirective({ sessionId: 's1', userId: 'u1' });
    expect(loaded.text).not.toContain('move toward the climax');
    expect(captured.filter((log) => typeof log.msg === 'string' && log.msg.startsWith('DM_PACING'))).toHaveLength(0);
  });

  test('a combat-held turn logs nothing: the DM was not told', async () => {
    reset();
    playerTurnCount = 50;
    encounterHolder.value = { id: 'enc1' };
    const { loadStoryTrackerDirective } = await import('../story-tracker.js');
    const loaded = await loadStoryTrackerDirective({ sessionId: 's1', userId: 'u1' });
    expect(loaded.text).toContain('Combat is under way');
    expect(loaded.text).not.toContain('move toward the climax');
    expect(captured.filter((log) => typeof log.msg === 'string' && log.msg.startsWith('DM_PACING'))).toHaveLength(0);
  });

  test('the budget trip logs the climax turn on a 60th typed turn', async () => {
    reset();
    playerTurnCount = 60;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({ sessionId: 's1', userId: 'u1', changes: [] });
    expect(result.outcome).toBe('applied');
    expect(countQueries).toBeGreaterThan(0);
    const logs = pacingLogs('climax');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.msg).toBe('DM_PACING climax turn=60');
    expect(logs[0]!.sessionId).toBe('s1');
    expect(pacingLogs('ending_required')).toHaveLength(0);
  });

  test('the ending-required trip logs its turn even though the turn reports no_changes', async () => {
    reset();
    playerTurnCount = 66;
    sessionStateHolder.value = {
      tracker: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 5,
        endingRequired: false,
        budgetForced: true,
        lastMessageId: 'other',
      },
    };
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({ sessionId: 's1', userId: 'u1', changes: [] });
    // The trip stores the phase but applies no clock change: no_changes,
    // and the log gates on the flag alone, not the outcome.
    expect(result.outcome).toBe('no_changes');
    const logs = pacingLogs('ending_required');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.msg).toBe('DM_PACING ending_required turn=66');
    expect(logs[0]!.sessionId).toBe('s1');
    expect(pacingLogs('climax')).toHaveLength(0);
  });

  test('a clock-limit phase never logs: the COUNT does not even run', async () => {
    reset();
    sessionStateHolder.value = {
      tracker: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 5,
        endingRequired: false,
        lastMessageId: 'other',
      },
    };
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({ sessionId: 's1', userId: 'u1', changes: [] });
    expect(result.outcome).toBe('no_changes');
    expect(countQueries).toBe(0);
    expect(captured.filter((log) => typeof log.msg === 'string' && log.msg.startsWith('DM_PACING'))).toHaveLength(0);
  });

  test('a Retry replay of the trip turn logs nothing', async () => {
    reset();
    playerTurnCount = 60;
    sessionStateHolder.value = {
      tracker: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 0,
        endingRequired: false,
        budgetForced: true,
        lastMessageId: 'msg1',
      },
    };
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({ sessionId: 's1', userId: 'u1', changes: [] });
    expect(result.outcome).toBe('already_applied');
    expect(captured.filter((log) => typeof log.msg === 'string' && log.msg.startsWith('DM_PACING'))).toHaveLength(0);
  });

  test('a clock-crossing turn at COUNT 60 logs no climax line: the clock wins', async () => {
    reset();
    playerTurnCount = 60;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({
      sessionId: 's1',
      userId: 'u1',
      changes: [{ name: 'Breath', set: 6 }],
    });
    // The clock reached its limit, so its climax phase (not budgetForced)
    // is stored and the budget trip's log block is skipped.
    expect(result.outcome).toBe('applied');
    expect(pacingLogs('climax')).toHaveLength(0);
    expect(pacingLogs('ending_required')).toHaveLength(0);
  });

  test('a repeated budget-climax turn logs no second ending_required line', async () => {
    reset();
    playerTurnCount = 67;
    sessionStateHolder.value = {
      tracker: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 6,
        endingRequired: true,
        budgetForced: true,
        lastMessageId: 'other',
      },
    };
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({ sessionId: 's1', userId: 'u1', changes: [] });
    expect(result.outcome).toBe('no_changes');
    // The COUNT still runs on budget-phase turns; only the log is suppressed.
    expect(countQueries).toBeGreaterThan(0);
    expect(pacingLogs('ending_required')).toHaveLength(0);
  });

  test('the engine-written ending logs its turn on a budget-forced net', async () => {
    reset();
    envelopeHolder.value = {};
    validEndingHolder.value = false;
    const { enforceRequiredEnding } = await import('../story-tracker.js');
    const result = await enforceRequiredEnding({
      userId: 'u1',
      sessionId: 's1',
      clock: 'Breath',
      budgetForced: true,
      turns: 67,
      regenerate: async () => ({ text: 'no ending here' }),
    });
    expect(result.outcome).toBe('engine_forced');
    const logs = pacingLogs('engine_ending');
    expect(logs).toHaveLength(1);
    expect(logs[0]!.msg).toBe('DM_PACING engine_ending turn=67');
    expect(logs[0]!.sessionId).toBe('s1');
  });

  test('a declared ending logs no engine-ending line', async () => {
    reset();
    envelopeHolder.value = { campaign_ending: { summary: 'declared ending' } };
    validEndingHolder.value = true;
    applyEndingHolder.value = { outcome: 'applied', summary: 'declared ending' };
    const { enforceRequiredEnding } = await import('../story-tracker.js');
    const result = await enforceRequiredEnding({
      userId: 'u1',
      sessionId: 's1',
      clock: 'Breath',
      budgetForced: true,
      turns: 67,
      regenerate: async () => ({ text: 'declared' }),
    });
    expect(result.outcome).toBe('declared');
    expect(pacingLogs('engine_ending')).toHaveLength(0);
  });

  test('a non-budget engine ending logs nothing', async () => {
    reset();
    envelopeHolder.value = {};
    validEndingHolder.value = false;
    const { enforceRequiredEnding } = await import('../story-tracker.js');
    const result = await enforceRequiredEnding({
      userId: 'u1',
      sessionId: 's1',
      clock: 'Breath',
      turns: 67,
      regenerate: async () => ({ text: 'no ending here' }),
    });
    expect(result.outcome).toBe('engine_forced');
    expect(pacingLogs('engine_ending')).toHaveLength(0);
  });
});
