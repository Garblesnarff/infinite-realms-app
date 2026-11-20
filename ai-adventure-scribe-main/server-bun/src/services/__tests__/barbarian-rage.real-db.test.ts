/**
 * Rage in a fight (#1638) against a real Postgres: the raging mark, its guarded claim, its expiry
 * at a round, its clearing at the end of the fight, and the client whole-blob writes that must
 * neither set nor clear it. The mark lives in `game_sessions.session_state`, which a mocked `db`
 * cannot show, so this suite runs against the scratch database. Requires TEST_DATABASE_URL or
 * DATABASE_URL -- see fixtures/real-db.ts. No suite here calls the live DM.
 */
import { afterAll, beforeAll, beforeEach, expect, it } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';

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
  characterFeatures,
  characterStats,
  characters,
  classFeaturesLibrary,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';

const {
  claimRage,
  clearFightFlags,
  clearRage,
  isRaging,
  combatTurnFlagsPreservingState,
  RAGE_DURATION_ROUNDS,
} = await importWithRealDb(() => import('../combat/combat-turn-flags.js'));
const { refillCountedFeatures } = await importWithRealDb(
  () => import('../progression/limited-feature-uses.js'),
);
const { resolveRage, rageIsOffered } = await importWithRealDb(
  () => import('../combat/barbarian-rage-service.js'),
);
const { SessionService } = await importWithRealDb(() => import('../session-service.js'));

if (!hasRealDb) {
  console.warn(
    '[barbarian-rage] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.',
  );
}

describeWithDb('Rage in a fight (#1638)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('rage-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let barbarianId: string;
  let featureId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('rage-camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: testId('barbarian'), level: 3, class: 'Barbarian' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      dexterity: 12,
      charisma: 10,
      armorClass: 14,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });

    [{ id: featureId }] = await db
      .insert(classFeaturesLibrary)
      .values({
        className: 'Barbarian',
        featureName: 'Rage',
        levelAcquired: 1,
        // Test-only row: the description is never asserted, only the NOT NULL column it fills.
        description: 'Test-only Rage row (two uses at 1st level), inserted by the #1638 suite.',
        usageType: 'limited_use',
        usesPerRest: 'long_rest',
        usesCount: 2,
      })
      .returning({ id: classFeaturesLibrary.id });

    await db
      .insert(characterFeatures)
      .values({ characterId, featureId, usesRemaining: 2, isActive: true, acquiredAtLevel: 1 });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const [barbarian] = await db
      .insert(combatParticipants)
      .values({
        encounterId,
        characterId,
        name: 'The Barbarian',
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: 14,
        maxHp: 30,
        speed: 30,
      })
      .returning({ id: combatParticipants.id });
    barbarianId = barbarian.id;

    await db
      .insert(combatParticipantStatus)
      .values({ participantId: barbarianId, currentHp: 30, maxHp: 30, isConscious: true });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characterFeatures).where(eq(characterFeatures.characterId, characterId));
    await db.delete(classFeaturesLibrary).where(eq(classFeaturesLibrary.id, featureId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  /** A fresh round 1, no Rage on the session, and both Rage uses back on the sheet. */
  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .update(combatEncounters)
      .set({ currentRound: 1, currentTurnOrder: 0 })
      .where(eq(combatEncounters.id, encounterId));
    await db.update(gameSessions).set({ sessionState: {} }).where(eq(gameSessions.id, sessionId));
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 2 })
      .where(eq(characterFeatures.characterId, characterId));
  });

  const setRound = async (round: number): Promise<void> => {
    await db
      .update(combatEncounters)
      .set({ currentRound: round })
      .where(eq(combatEncounters.id, encounterId));
  };

  const storedRage = async (): Promise<unknown> => {
    const [row] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId));
    return (row?.state as Record<string, unknown>)?.raging ?? null;
  };

  it('a claim makes the Barbarian raging for ten rounds, from the round it starts in', async () => {
    expect(await claimRage(encounterId, barbarianId)).toBe(1 + RAGE_DURATION_ROUNDS);
    expect(await isRaging(encounterId, barbarianId)).toBe(true);
    expect(RAGE_DURATION_ROUNDS).toBe(10);
    expect(await storedRage()).toMatchObject({
      [barbarianId]: { encounterId, expiresRound: 1 + RAGE_DURATION_ROUNDS },
    });
  });

  it('a second claim while raging writes nothing, and the first mark stays', async () => {
    await claimRage(encounterId, barbarianId);
    await setRound(4);
    expect(await claimRage(encounterId, barbarianId)).toBeNull();
    expect(await storedRage()).toMatchObject({
      [barbarianId]: { encounterId, expiresRound: 1 + RAGE_DURATION_ROUNDS },
    });
  });

  it('Rage ends when its round passes: raging on round 10, not on round 11', async () => {
    await claimRage(encounterId, barbarianId);
    await setRound(10);
    expect(await isRaging(encounterId, barbarianId)).toBe(true);
    await setRound(11);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
    // An expired mark can be claimed again.
    expect(await claimRage(encounterId, barbarianId)).toBe(11 + RAGE_DURATION_ROUNDS);
  });

  it('the end of the fight clears the raging mark of that fight', async () => {
    await claimRage(encounterId, barbarianId);
    await clearFightFlags(db, encounterId);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('clearRage drops the mark when an activation failed after its claim', async () => {
    await claimRage(encounterId, barbarianId);
    await clearRage(encounterId, barbarianId);
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  // The three client-write tests (#1647 pattern): a whole-blob session write from the client may
  // neither set, nor clear, nor drop the engine's raging mark.
  const update = (sessionState: Record<string, unknown>) =>
    SessionService!.updateSession(sessionId, userId, { sessionState } as never);

  it('a client whole-blob session write that omits the raging mark keeps it', async () => {
    await claimRage(encounterId, barbarianId);
    await update({ notes: 'client snapshot' });
    expect(await isRaging(encounterId, barbarianId)).toBe(true);
  });

  it('a client whole-blob write that empties the raging bucket cannot clear the mark', async () => {
    await claimRage(encounterId, barbarianId);
    await update({ raging: {} });
    expect(await isRaging(encounterId, barbarianId)).toBe(true);
  });

  it('a client whole-blob write cannot set a raging mark that the engine did not claim', async () => {
    await update({
      raging: { [barbarianId]: { encounterId, expiresRound: 99 } },
    });
    expect(await isRaging(encounterId, barbarianId)).toBe(false);
  });

  it('the combat-turn-flags fold keeps the stored mark through a client blob write', async () => {
    await claimRage(encounterId, barbarianId);
    await db
      .update(gameSessions)
      .set({
        sessionState: sql`${combatTurnFlagsPreservingState(sql`'{}'::jsonb`)}`,
      })
      .where(eq(gameSessions.id, sessionId));
    expect(await isRaging(encounterId, barbarianId)).toBe(true);
  });

  it('the Rage chip is offered with a use left and no live Rage, and hidden while raging or spent', async () => {
    const offer = () =>
      rageIsOffered({ characterId, userId, participantId: barbarianId, encounterId });
    expect(await offer()).toBe(true);
    await claimRage(encounterId, barbarianId);
    expect(await offer()).toBe(false);
    await clearRage(encounterId, barbarianId);
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 0 })
      .where(eq(characterFeatures.characterId, characterId));
    expect(await offer()).toBe(false);
  });

  it('resolveRage spends one use, and a second activation while raging is refused and spends nothing', async () => {
    const first = await resolveRage({
      characterId,
      userId,
      participantId: barbarianId,
      encounterId,
    });
    expect(first).toEqual({ usesRemaining: 1, expiresRound: 1 + RAGE_DURATION_ROUNDS });
    expect(await isRaging(encounterId, barbarianId)).toBe(true);

    // Still raging: a second activation is refused and spends nothing.
    await expect(
      resolveRage({ characterId, userId, participantId: barbarianId, encounterId }),
    ).rejects.toThrow(/Already raging/);
    const [row] = await db
      .select({ uses: characterFeatures.usesRemaining })
      .from(characterFeatures)
      .where(
        and(
          eq(characterFeatures.characterId, characterId),
          eq(characterFeatures.featureId, featureId),
        ),
      );
    expect(row.uses).toBe(1);
  });
  it('a long rest refills the Rage uses, and a short rest does not (#1638)', async () => {
    const ragesLeft = async (): Promise<number> => {
      const [row] = await db
        .select({ uses: characterFeatures.usesRemaining })
        .from(characterFeatures)
        .where(
          and(
            eq(characterFeatures.characterId, characterId),
            eq(characterFeatures.featureId, featureId),
          ),
        );
      return row.uses ?? -1;
    };
    await db
      .update(characterFeatures)
      .set({ usesRemaining: 0 })
      .where(eq(characterFeatures.characterId, characterId));

    await refillCountedFeatures(characterId, userId, 'short');
    expect(await ragesLeft()).toBe(0);

    // Level 3 Barbarian: three Rage uses (PHB table, rageUsesAt).
    await refillCountedFeatures(characterId, userId, 'long');
    expect(await ragesLeft()).toBe(3);
  });
});
