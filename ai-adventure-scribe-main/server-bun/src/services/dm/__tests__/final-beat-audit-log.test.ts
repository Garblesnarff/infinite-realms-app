/**
 * Audit-log tests for #1068 item 1 (FIX round 2): the
 * DM_STORY_TRACKER_FINAL_BEAT_FLAGGED line must fire exactly once when
 * a call arms the final-beat state, and never when the transaction
 * rolls back or when a Retry replays an already-applied message.
 *
 * The logger and the database are faked via bun's mock.module, so the
 * test asserts on the captured log objects, not on stdout text. The
 * fakes cover only the chains the arm path touches; everything else
 * (parseClockDefinitions, the arm logic, the audit merge) is the real
 * code under test. The real-route counterpart lives in
 * story-ending.real-db.test.ts (stdout capture on a live arm turn).
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
let updateShouldThrow = false;

class Chain {
  private table: unknown = null;
  private joined = false;
  /** True only for chains built by update(): the rollback test must throw on the update, not on a read. */
  private isUpdate = false;
  from(table: unknown): this {
    this.table = table;
    return this;
  }
  markUpdate(table: unknown): this {
    this.table = table;
    this.isUpdate = true;
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
    // FIX round 3 (foreman review): the old condition threw on the
    // transaction's opening gameSessions READ, before the arm — so the
    // test passed without the arm-then-throw shape it claimed. Only an
    // update chain throws now, which happens after the arm block sets
    // the flag: a true rollback-after-arm.
    if (updateShouldThrow && this.isUpdate) {
      reject(new Error('tx boom'));
      return;
    }
    try {
      resolve(rowsFor(this.table, this.joined));
    } catch (error) {
      reject(error);
    }
  }
}

function rowsFor(table: unknown, joined: boolean): unknown[] {
  if (table === dialogueHistory) return [{ id: 'msg1' }];
  if (table === campaignRules) {
    return [
      { condition: 'the Breath Clock reaches 6', metadata: {}, effect: null },
      { condition: 'the Glass Clock reaches 3', metadata: {}, effect: null },
    ];
  }
  if (table === sessionTrackers) return [{ name: 'Breath', value: 1, limit: 6 }];
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
  select: () => new Chain(),
  insert: () => new Chain(),
  update: (table: unknown) => new Chain().markUpdate(table),
};
const fakeDb = {
  select: () => new Chain(),
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

const flagged = () => captured.filter((log) => log.msg === 'DM_STORY_TRACKER_FINAL_BEAT_FLAGGED');

describe('DM_STORY_TRACKER_FINAL_BEAT_FLAGGED (#1068 FIX round 2)', () => {
  test('fires once on an armed turn, with the merged snapshot and join keys', async () => {
    captured.length = 0;
    sessionStateHolder.value = {};
    updateShouldThrow = false;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({
      sessionId: 's1',
      userId: 'u1',
      changes: [],
      finalBeatReached: true,
    });
    expect(result.outcome).toBe('applied');
    expect(flagged()).toHaveLength(1);
    const log = flagged()[0]!;
    expect(log.sessionId).toBe('s1');
    expect(log.playerMessageId).toBe('msg1');
    expect(log.starterCampaignId).toBe('camp1');
    expect(log.campaignLength).toBe('one-shot');
    // Stored row wins for Breath; defined-but-untouched Glass reads 0.
    expect(log.clocks).toEqual([
      { name: 'Breath', value: 1, limit: 6 },
      { name: 'Glass', value: 0, limit: 3 },
    ]);
    expect(log.lastClientScene).toBe('The Root Stair');
  });

  test('does not fire again on an already_applied Retry replay', async () => {
    captured.length = 0;
    sessionStateHolder.value = {
      tracker: {
        phase: 'climax',
        clock: 'Breath',
        climaxTurns: 0,
        endingRequired: true,
        finalBeat: true,
        lastMessageId: 'msg1',
      },
    };
    updateShouldThrow = false;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({
      sessionId: 's1',
      userId: 'u1',
      changes: [],
      finalBeatReached: true,
    });
    expect(result.outcome).toBe('already_applied');
    expect(flagged()).toHaveLength(0);
  });

  test('does not fire when the transaction rolls back', async () => {
    captured.length = 0;
    sessionStateHolder.value = {};
    updateShouldThrow = true;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    await expect(
      applyStoryTrackers({ sessionId: 's1', userId: 'u1', changes: [], finalBeatReached: true }),
    ).rejects.toThrow('tx boom');
    expect(flagged()).toHaveLength(0);
  });

  test('#1160: an invalid tracker entry on the same reply does not cancel the arm', async () => {
    captured.length = 0;
    sessionStateHolder.value = {};
    updateShouldThrow = false;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({
      sessionId: 's1',
      userId: 'u1',
      changes: [{ name: 'Breath' }],
      finalBeatReached: true,
    });
    expect(result.outcome).toBe('applied');
    expect(flagged()).toHaveLength(1);
    expect(result.finalBeatArmed).toBe(true);
  });

  test('#1160: an invalid tracker entry with no flag and no phase reports invalid_changes', async () => {
    captured.length = 0;
    sessionStateHolder.value = {};
    updateShouldThrow = false;
    const { applyStoryTrackers } = await import('../story-tracker.js');
    const result = await applyStoryTrackers({
      sessionId: 's1',
      userId: 'u1',
      changes: [{ name: 'Breath' }],
    });
    expect(result.outcome).toBe('invalid_changes');
    expect(flagged()).toHaveLength(0);
    expect(result.finalBeatArmed).toBeUndefined();
  });
});
