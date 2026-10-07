/**
 * Long rest fully recovers a dying character (#2600, round 4).
 *
 * The round-3 server reset only zeroed the death-save tallies with a raw
 * `db.update`, leaving the participant at 0 HP and unconscious — so
 * `vitalStateOf` still read "dying", and the sheet kept `vitalState: 'dying'`
 * at full HP. Round 4 heals through the #2618 write-through paths
 * (`CharacterVitalsService.heal` for the sheet, `CombatHPService.healDamage`
 * for participants), so HP, consciousness, tallies and vital state move
 * together. This suite drives `RestService.takeLongRest` against a real
 * database because the mocked suite cannot pin what the write-through
 * actually stores.
 *
 * Setup: a character with `character_stats` at 0 HP, `vitalState: 'dying'`,
 * saves {2,1}; one participant with status {currentHp 0, isConscious false,
 * saves 2/1}. After `takeLongRest`:
 *   - participant status is currentHp = max, isConscious true, saves 0/0
 *   - `vitalStateOf` of the hydrated participant is 'standing'
 *   - `character_stats` is vitalState 'standing', isConscious true, saves 0/0,
 *     currentHitPoints = max
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
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
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
const { vitalStateOf } = await importWithRealDb(() => import('../combat/vital-state.js'));

if (!hasRealDb) {
  console.warn(
    '[rest-long-rest-recovery] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

const MAX_HP = 30;

describeWithDb('long rest recovers a dying character through the write-through paths', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rest-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let participantId: string;
  let endedEncounterId: string;
  let endedParticipantId: string;

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
      maxHitPoints: MAX_HP,
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
        maxHp: MAX_HP,
      })
      .returning({ id: combatParticipants.id });

    // The participant: 0 HP, unconscious, mid death saves.
    await db.insert(combatParticipantStatus).values({
      participantId,
      currentHp: 0,
      maxHp: MAX_HP,
      tempHp: 0,
      isConscious: false,
      deathSavesSuccesses: 2,
      deathSavesFailures: 1,
    });

    // #2600 round 5: an ENDED encounter with a stale maxHp (10, from before a
    // level-up while the sheet max is 30). The long rest must not heal this
    // row, or the write-through mirror would overwrite the sheet HP with 10.
    [{ id: endedEncounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'completed', currentRound: 5, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    [{ id: endedParticipantId }] = await db
      .insert(combatParticipants)
      .values({
        encounterId: endedEncounterId,
        characterId,
        name: testId('hero-old'),
        participantType: 'player',
        turnOrder: 0,
        initiative: 5,
        maxHp: 10,
      })
      .returning({ id: combatParticipants.id });

    await db.insert(combatParticipantStatus).values({
      participantId: endedParticipantId,
      currentHp: 5,
      maxHp: 10,
      tempHp: 0,
      isConscious: true,
      deathSavesSuccesses: 0,
      deathSavesFailures: 0,
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
    await drop(() =>
      db
        .delete(combatParticipantStatus)
        .where(eq(combatParticipantStatus.participantId, endedParticipantId)),
    );
    await drop(() => db.delete(combatParticipants).where(eq(combatParticipants.id, endedParticipantId)));
    await drop(() => db.delete(combatEncounters).where(eq(combatEncounters.id, endedEncounterId)));
    await drop(() => db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId)));
    await drop(() => db.delete(gameSessions).where(eq(gameSessions.id, sessionId)));
    await drop(() => db.delete(characterStats).where(eq(characterStats.characterId, characterId)));
    await drop(() => db.delete(characters).where(eq(characters.id, characterId)));
    await drop(() => db.delete(campaigns).where(eq(campaigns.id, campaignId)));
    await closeRealDb();
  });

  it('a dying participant at 0 HP with saves {2,1} rests to full HP, conscious, 0/0, standing', async () => {
    if (!hasRealDb) return;

    await RestService.takeLongRest(characterId, userId);

    // Participant row: HP max, conscious, tallies 0/0.
    const [status] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
    expect(status.currentHp).toBe(MAX_HP);
    expect(status.isConscious).toBe(true);
    expect(status.deathSavesSuccesses).toBe(0);
    expect(status.deathSavesFailures).toBe(0);

    // The derived vital state is standing, not "dying at 0/0".
    expect(
      vitalStateOf({
        participantType: 'player',
        maxHp: status.maxHp,
        status: {
          currentHp: status.currentHp,
          isConscious: status.isConscious,
          deathSavesSuccesses: status.deathSavesSuccesses,
          deathSavesFailures: status.deathSavesFailures,
        },
      }),
    ).toBe('standing');

    // The sheet: HP max, conscious, tallies 0/0, vitalState standing.
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    expect(stats.currentHitPoints).toBe(MAX_HP);
    expect(stats.isConscious).toBe(true);
    expect(stats.deathSavesSuccesses).toBe(0);
    expect(stats.deathSavesFailures).toBe(0);
    expect(stats.vitalState).toBe('standing');
  });

  it('does not heal participants in ended encounters and leaves the sheet at its max', async () => {
    if (!hasRealDb) return;

    // The rest already ran in the previous test; the sheet is at max.
    // Verify the ended encounter's stale row was not healed and did not
    // overwrite the sheet HP via the write-through mirror.
    const [endedStatus] = await db
      .select()
      .from(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, endedParticipantId));
    // Untouched: still 5/10, not healed to 10.
    expect(endedStatus.currentHp).toBe(5);
    expect(endedStatus.maxHp).toBe(10);

    // The sheet HP is the sheet max (30), not the stale encounter max (10).
    const [stats] = await db
      .select()
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId));
    expect(stats.currentHitPoints).toBe(MAX_HP);
    expect(stats.maxHitPoints).toBe(MAX_HP);
  });
});
