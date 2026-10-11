/**
 * Long rest refuses a dying or dead character (#180).
 *
 * This suite previously pinned #2600 round 4: a long rest fully recovered a
 * dying character. #180 decided the opposite as the product rule (2014 PHB: a
 * character needs at least 1 HP at the start of a long rest to gain its
 * benefits), so the old expectation is wrong under the new rule and the suite
 * now pins the refusal instead: dying or dead refuses both rests server-side
 * with a clear message, a stable character at 0 HP is refused the long rest
 * but may short rest, and a refused rest writes nothing.
 *
 * Drives `RestService.takeLongRest` / `takeShortRest` against a real database
 * because the mocked suite cannot pin what the refusal leaves stored.
 *
 * Setup: a character with `character_stats` at 0 HP, `vitalState: 'dying'`,
 * saves {2,1}; one participant with status {currentHp 0, isConscious false,
 * saves 2/1}.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterHitDice,
  characterSpellSlots,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  restEvents,
} from '../../../../db/schema/index';

const stub = () => ({
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

const { RestService } = await importWithRealDb(() => import('../rest-service.js'));
const { BusinessLogicError } = await importWithRealDb(() => import('../../lib/errors.js'));

if (hasRealDb && !process.env.DATABASE_URL && process.env.TEST_DATABASE_URL) {
  // The suites import the server's db/client, which throws when DATABASE_URL
  // is unset; TEST_DATABASE_URL alone un-skips the tests but not the import.
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

if (!hasRealDb) {
  console.warn(
    '[rest-long-rest-recovery] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('long rest refuses a dying or dead character (#180)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rest-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let participantId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 3, class: 'Fighter' })
      .returning({ id: characters.id });

    // The sheet: 0 HP, dying, mid death saves.
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: 30,
      currentHitPoints: 0,
      temporaryHitPoints: 0,
      isConscious: false,
      vitalState: 'dying',
      deathSavesSuccesses: 2,
      deathSavesFailures: 1,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: participantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId,
        name: testId('hero'),
        participantType: 'player',
        turnOrder: 0,
        initiative: 10,
        maxHp: 30,
      })
      .returning({ id: combatParticipants.id });

    // The participant: 0 HP, unconscious, mid death saves.
    await db.insert(combatParticipantStatus).values({
      participantId,
      currentHp: 0,
      maxHp: 30,
      tempHp: 0,
      isConscious: false,
      deathSavesSuccesses: 2,
      deathSavesFailures: 1,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    const drop = async (run: () => Promise<unknown>) => {
      try {
        await run();
      } catch {
        /* fixture teardown is best-effort */
      }
    };
    await drop(() =>
      db.delete(combatParticipantStatus).where(eq(combatParticipantStatus.participantId, participantId)),
    );
    await drop(() => db.delete(combatParticipants).where(eq(combatParticipants.id, participantId)));
    await drop(() => db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId)));
    await drop(() => db.delete(gameSessions).where(eq(gameSessions.id, sessionId)));
    await drop(() => db.delete(restEvents).where(eq(restEvents.characterId, characterId)));
    await drop(() => db.delete(characterStats).where(eq(characterStats.characterId, characterId)));
    await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    // NOTE: do NOT closeRealDb() here — the story-long-rest describe below
    // shares this file's pool; only the last describe closes it.
  });

  const setVitals = (
    vitalState: 'dying' | 'dead' | 'stabilized',
    currentHitPoints: number,
  ): Promise<unknown> =>
    db
      .update(characterStats)
      .set({ vitalState, currentHitPoints })
      .where(eq(characterStats.characterId, characterId));

  const readStats = async (): Promise<{
    currentHitPoints: number;
    vitalState: string;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  }> => {
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    return stats;
  };

  const restEventCount = async (): Promise<number> => {
    const rows = await db
      .select({ id: restEvents.id })
      .from(restEvents)
      .where(eq(restEvents.characterId, characterId));
    return rows.length;
  };

  it('refuses a long rest while dying, with a clear message, and writes nothing', async () => {
    if (!hasRealDb) return;

    let thrown: unknown;
    try {
      await RestService.takeLongRest(characterId, userId);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(BusinessLogicError);
    expect((thrown as Error).message).toBe('Cannot take a long rest while dying.');

    // Nothing moved: still 0 HP, still dying, saves intact, no rest recorded.
    const stats = await readStats();
    expect(stats.currentHitPoints).toBe(0);
    expect(stats.vitalState).toBe('dying');
    expect(stats.deathSavesSuccesses).toBe(2);
    expect(stats.deathSavesFailures).toBe(1);
    expect(await restEventCount()).toBe(0);
  });

  it('refuses a short rest while dying too', async () => {
    if (!hasRealDb) return;

    await expect(RestService.takeShortRest(characterId, userId)).rejects.toThrow(
      'Cannot take a short rest while dying.',
    );
    expect(await restEventCount()).toBe(0);
  });

  it('refuses both rests while dead', async () => {
    if (!hasRealDb) return;
    await setVitals('dead', 0);

    await expect(RestService.takeLongRest(characterId, userId)).rejects.toThrow(
      'Cannot take a long rest while dead.',
    );
    await expect(RestService.takeShortRest(characterId, userId)).rejects.toThrow(
      'Cannot take a short rest while dead.',
    );
    expect(await restEventCount()).toBe(0);
  });

  it('a stable character at 0 HP is refused the long rest but may short rest', async () => {
    if (!hasRealDb) return;
    await setVitals('stabilized', 0);

    await expect(RestService.takeLongRest(characterId, userId)).rejects.toThrow(
      'A long rest requires at least 1 hit point to grant its benefits.',
    );
    expect(await restEventCount()).toBe(0);

    // The short rest is allowed: nothing is spent, but the rest is recorded.
    const result = await RestService.takeShortRest(characterId, userId);
    expect(result.restType).toBe('short');
    expect(await restEventCount()).toBe(1);
  });
});

/**
 * A story long rest (#264): the DM declares the rest during the narrative,
 * out of combat. There is no encounter and no button — the DM turn invokes
 * the same `RestService.takeLongRest`, and the sheet must show the 2014 5e
 * result: full HP, all spell slots restored, half of total hit dice back
 * (rounded down, minimum 1).
 */
describeWithDb('a story long rest restores the sheet (#264)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rest-story-user');

  let campaignId: string;
  let characterId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('hero'), level: 3, class: 'Fighter' })
      .returning({ id: characters.id });

    // Mid-adventure state: hurt, slots spent, hit dice spent. No encounter —
    // this rest happens in the story, out of combat.
    await db.insert(characterStats).values({
      characterId,
      maxHitPoints: 12,
      currentHitPoints: 9,
      temporaryHitPoints: 0,
      isConscious: true,
      vitalState: 'standing',
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
    });

    await db.insert(characterSpellSlots).values({
      characterId,
      spellLevel: 1,
      totalSlots: 2,
      usedSlots: 2,
    });

    await db.insert(characterHitDice).values({
      characterId,
      className: 'Fighter',
      dieType: 'd10',
      totalDice: 4,
      usedDice: 3,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(characterHitDice).where(eq(characterHitDice.characterId, characterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  it('restores HP, spell slots, and half the hit dice on the sheet', async () => {
    if (!hasRealDb) return;

    // What the DM turn invokes when the story declares a long rest.
    const result = await RestService.takeLongRest(characterId, userId);
    expect(result.restType).toBe('long');
    expect(result.hpRestored).toBe(3);

    // The sheet reads character_stats: full HP.
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    expect(stats.currentHitPoints).toBe(12);
    expect(stats.maxHitPoints).toBe(12);

    // All spell slots restored.
    const [slots] = await db
      .select()
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
    expect(slots.usedSlots).toBe(0);
    expect(slots.totalSlots).toBe(2);

    // Half of 4 total, rounded down: 2 restored, 3 used -> 1 used.
    expect(result.hitDiceRestored).toBe(2);
    const [hitDice] = await db
      .select()
      .from(characterHitDice)
      .where(eq(characterHitDice.characterId, characterId));
    expect(hitDice.usedDice).toBe(1);
  });
});
