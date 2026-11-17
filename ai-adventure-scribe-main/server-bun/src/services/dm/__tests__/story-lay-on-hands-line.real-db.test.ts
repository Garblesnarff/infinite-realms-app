/**
 * #1597 (4): a typed Lay on Hands outside a fight that the engine resolved returns its engine line,
 * and the line is posted to the chat. A refused one returns no line, so the gate still checks the
 * reply. Runs only in the real-DB CI job; never against a shared database.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { and, eq } from 'drizzle-orm';

import {
  campaigns,
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  dialogueHistory,
  featureUsageLog,
  gameSessions,
} from '../../../../../db/schema/index';
import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from '../../__tests__/fixtures/real-db.js';

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

const { spendStoryFeatureUses } = await importWithRealDb(() => import('../story-feature-uses.js'));
const { layOnHandsPool } = await importWithRealDb(
  () => import('../../progression/paladin-features-service.js'),
);

const userId = testId('1597-user');
const PLAYER_INPUT = 'I use Lay on Hands on myself for 5 hit points';

describeWithDb('a typed Lay on Hands outside a fight (#1597)', () => {
  let db: ReturnType<typeof realDb>;
  let campaignId: string;
  let sessionId: string;
  let characterId: string;
  let featureId: string;

  const freshPaladin = async (currentHitPoints: number, pool: number) => {
    const [{ id: cid }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('1597-pal'), class: 'Paladin', level: 1 })
      .returning({ id: characters.id });
    await db.insert(characterStats).values({
      characterId: cid,
      charisma: 8,
      maxHitPoints: 12,
      currentHitPoints,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
    });
    // The pool row is the service's own (ensurePoolRow); set its remaining points for the case.
    const row = await layOnHandsPool(cid, userId);
    await db
      .update(characterFeatures)
      .set({ usesRemaining: pool })
      .where(eq(characterFeatures.id, row!.row.id));
    return cid;
  };

  const engineRows = async () =>
    db
      .select({ message: dialogueHistory.message })
      .from(dialogueHistory)
      .where(
        and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'system')),
      );

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    const [existing] = await db
      .select({ id: classFeaturesLibrary.id })
      .from(classFeaturesLibrary)
      .where(
        and(
          eq(classFeaturesLibrary.className, 'Paladin'),
          eq(classFeaturesLibrary.featureName, 'Lay on Hands'),
        ),
      )
      .limit(1);
    featureId =
      existing?.id ??
      (
        await db
          .insert(classFeaturesLibrary)
          .values({
            className: 'Paladin',
            featureName: 'Lay on Hands',
            levelAcquired: 1,
            description: 'test',
            usageType: 'action',
            usesPerRest: 'long_rest',
            usesCount: null,
          })
          .returning({ id: classFeaturesLibrary.id })
      )[0].id;
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('1597-camp') })
      .returning({ id: campaigns.id });
    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db.delete(dialogueHistory).where(eq(dialogueHistory.sessionId, sessionId));
    characterId = await freshPaladin(7, 5);
  });

  afterAll(async () => {
    if (hasRealDb) await closeRealDb();
  });

  const spend = (cid: string) =>
    spendStoryFeatureUses({
      userId,
      sessionId,
      playerInput: PLAYER_INPUT,
      character: { id: cid } as never,
      features: ['lay on hands'],
    });

  it('a resolved heal returns its engine line and posts it to the chat', async () => {
    const lines = await spend(characterId);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('restores 5 HP');
    const rows = await engineRows();
    expect(rows.map((row) => row.message)).toContain(lines[0]);
  });

  it('a retried turn returns the same line and draws nothing again (#1597)', async () => {
    const RETRY_INPUT = 'I use Lay on Hands on myself for 2 hit points';
    // The player message the turn answers. A Retry replays this same message.
    await db
      .insert(dialogueHistory)
      .values({ sessionId, speakerType: 'player', message: RETRY_INPUT });
    const cid = await freshPaladin(10, 5);
    const retrySpend = () =>
      spendStoryFeatureUses({
        userId,
        sessionId,
        playerInput: RETRY_INPUT,
        character: { id: cid } as never,
        features: ['lay on hands'],
      });

    const first = await retrySpend();
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('restores 2 HP');
    expect((await layOnHandsPool(cid, userId))!.remaining).toBe(3);

    const retry = await retrySpend();
    expect(retry).toEqual(first);
    // One draw in all: the pool is still 3, and one usage row exists for this character.
    expect((await layOnHandsPool(cid, userId))!.remaining).toBe(3);
    const usage = await db
      .select({ id: featureUsageLog.id })
      .from(featureUsageLog)
      .where(and(eq(featureUsageLog.characterId, cid), eq(featureUsageLog.featureId, featureId)));
    expect(usage).toHaveLength(1);
  });

  it('a refused heal (empty pool) returns no line and posts nothing', async () => {
    const cid = await freshPaladin(7, 0);
    const lines = await spend(cid);
    expect(lines).toEqual([]);
    expect(await engineRows()).toEqual([]);
  });
});
