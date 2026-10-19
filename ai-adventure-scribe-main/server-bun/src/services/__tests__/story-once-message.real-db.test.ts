/**
 * #777 item 3: two overlapping applies for one player message land once.
 *
 * /generate calls applyStoryDamage and applyStoryRest after the model returns.
 * A non-roll turn does not hold the session lock across that work, so two
 * generates can enter the appliers together. This drives those appliers in
 * parallel. It does not call a provider.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { expect, it, mock } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import { describeWithDb, hasRealDb, importWithRealDb, realDb, testId } from './fixtures/real-db.js';
import {
  campaigns,
  characterHitDice,
  characterStats,
  characters,
  dialogueHistory,
  gameSessions,
  restEvents,
} from '../../../../db/schema/index';

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

const { applyStoryDamage } = await importWithRealDb(() => import('../dm/story-damage.js'));
const { applyStoryRest } = await importWithRealDb(() => import('../dm/story-rest.js'));

if (!hasRealDb) {
  console.warn(
    '[story-once-message] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('#777 two parallel story applies for one message', () => {
  const db = hasRealDb ? realDb() : (null as never);

  async function world(
    label: string,
    currentHitPoints: number,
    maxHitPoints: number,
  ): Promise<{ userId: string; characterId: string; sessionId: string; campaignId: string }> {
    const userId = testId(`${label}-user`);
    const [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId(`${label}-camp`) })
      .returning({ id: campaigns.id });
    const [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId(`${label}-hero`),
        level: 3,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints,
      currentHitPoints,
      temporaryHitPoints: 0,
      constitution: 14,
      isConscious: true,
      vitalState: 'standing',
    });
    const [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId })
      .returning({ id: gameSessions.id });
    await db.insert(dialogueHistory).values({
      sessionId,
      speakerType: 'player',
      message: 'I stay where I am.',
    });
    return { userId, characterId, sessionId, campaignId };
  }

  async function cleanup(
    characterId: string,
    sessionId: string,
    campaignId: string,
  ): Promise<void> {
    await db.delete(restEvents).where(eq(restEvents.characterId, characterId));
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, characterId));
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
  }

  it('applies story damage once when two calls overlap', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('777-dmg', 12, 12);
    try {
      const outcomes = await Promise.all([
        applyStoryDamage({
          userId,
          sessionId,
          damage: { amount: 3, source: 'rope burn' },
        }),
        applyStoryDamage({
          userId,
          sessionId,
          damage: { amount: 3, source: 'rope burn' },
        }),
      ]);
      expect(outcomes.slice().sort()).toEqual(['already_applied', 'applied']);
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(9);
      const lines = await db
        .select({ message: dialogueHistory.message })
        .from(dialogueHistory)
        .where(
          and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
        );
      expect(lines).toHaveLength(1);
      expect(lines[0]?.message).toContain('story damage — rope burn deals 3 damage');
      expect(lines[0]?.message).toContain('HP 9/12');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });

  it('applies a story long rest once when two calls overlap', async () => {
    const { userId, characterId, sessionId, campaignId } = await world('777-rest', 6, 20);
    try {
      const outcomes = await Promise.all([
        applyStoryRest({ userId, sessionId, rest: { type: 'long' } }),
        applyStoryRest({ userId, sessionId, rest: { type: 'long' } }),
      ]);
      expect(outcomes.slice().sort()).toEqual(['already_applied', 'applied']);
      const [stats] = await db
        .select({ current: characterStats.currentHitPoints })
        .from(characterStats)
        .where(eq(characterStats.characterId, characterId));
      expect(stats?.current).toBe(20);
      const events = await db
        .select({ id: restEvents.id, restType: restEvents.restType })
        .from(restEvents)
        .where(eq(restEvents.characterId, characterId));
      expect(events).toHaveLength(1);
      expect(events[0]?.restType).toBe('long');
    } finally {
      await cleanup(characterId, sessionId, campaignId);
    }
  });
});
