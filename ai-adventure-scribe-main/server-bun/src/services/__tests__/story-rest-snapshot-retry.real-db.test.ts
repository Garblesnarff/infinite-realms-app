/**
 * #777 FIX: a throw while reading the rest snapshot must drop the claim.
 * The next call then applies once. The hook stands in for a failed read.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import { describeWithDb, hasRealDb, importWithRealDb } from './fixtures/real-db.js';
import {
  storyClaimCleanup,
  storyClaimDb,
  storyClaimHp,
  storyClaimWorld,
} from './story-claim-fixture.js';
import { restEvents } from '../../../../db/schema/index';

interface LogStub {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  child: () => LogStub;
}

const stub = (): LogStub => ({
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: () => stub(),
});
mock.module('../../lib/logger.js', () => ({
  logger: stub(),
  combatLogger: stub(),
  spellLogger: stub(),
  progressionLogger: stub(),
  errorLogSerializers: {},
  default: stub(),
}));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { applyStoryRest } = await importWithRealDb(() => import('../dm/story-rest.js'));
const { RestService } = await importWithRealDb(() => import('../rest-service.js'));

describeWithDb('#777 rest snapshot retry', () => {
  const db = hasRealDb ? storyClaimDb() : (null as never);
  const rest = { type: 'long' as const };

  it('a throw on the first snapshot releases the claim so the retry lands once', async () => {
    const { userId, characterId, sessionId, campaignId } = await storyClaimWorld(
      '777-rest-snap',
      6,
      20,
    );
    let reads = 0;
    RestService.storyRestSnapshotForTests = () => {
      reads += 1;
      if (reads === 1) throw new Error('snapshot failed');
    };
    try {
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('rest_failed');
      expect(await storyClaimHp(characterId)).toBe(6);
      const blocked = await db
        .select({ id: restEvents.id })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(blocked).toHaveLength(0);
      expect(await applyStoryRest({ userId, sessionId, rest })).toBe('applied');
      expect(await storyClaimHp(characterId)).toBe(20);
      const events = await db
        .select({ id: restEvents.id })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(events).toHaveLength(1);
    } finally {
      RestService.storyRestSnapshotForTests = undefined;
      await storyClaimCleanup(characterId, sessionId, campaignId);
    }
  });
});
