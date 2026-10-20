/* eslint-disable max-lines -- one fixture chain (campaign -> warlock -> session -> encounter ->
   participants -> board) shared by every assertion; splitting it would build the encounter twice. */
/**
 * Hex, the 2014 warlock curse (#754), against a real Postgres.
 *
 * Warlocks are the only class with Hex, so the whole feature is dead until a warlock can cast
 * it: the combat-spell gate refused any concentration spell (#709 Round 2 noted the eight-id
 * allowance), and nothing recorded which participant the curse landed on. This suite drives the
 * real entry points the HTTP intent route calls:
 *
 *   - `resolveSpellAttack` for the bonus-action cast -> concentration row with its target
 *   - `resolveAttack` for the rider -> 1d6 necrotic only against the cursed participant
 *
 * A mocked `db` cannot cover this: the whole bug class the real-DB harness exists for is writes
 * that never reach Postgres. Requires TEST_DATABASE_URL or DATABASE_URL -- see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';

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
  characterConcentration,
  characterSpellSlots,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
} from '../../../../db/schema/index';
import { setRngSeed } from '../../lib/rng.js';

// The live-route block below fakes only authentication, so the intent route, reference
// resolution, the combat services, and the concentration write are all the production code.
const LIVE_USER_PREFIX = 'hex-live-route-user-';
const liveUserId = `${LIVE_USER_PREFIX}${process.pid}`;

mock.module('../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/, '');
    return token && token.startsWith(LIVE_USER_PREFIX)
      ? { user: { userId: token, email: 'hex@example.test', plan: 'free' }, error: null }
      : { user: null, error: 'Unauthorized' };
  },
}));

const { intentRoutes } = await importWithRealDb(() => import('../../routes/v1/combat/intents.js'));

// Keep production imports behind the same database gate as describeWithDb: db/client throws at
// import time without DATABASE_URL, which is an environment error, not a test result.
const combatAttackService = hasRealDb
  ? (await import('../combat/combat-attack-service.js')).combatAttackService
  : undefined;
const getConcentration = hasRealDb
  ? (await import('../combat/concentration-service.js')).getConcentration
  : undefined;
const dropConcentration = hasRealDb
  ? (await import('../combat/concentration-service.js')).dropConcentration
  : undefined;
const startConcentration = hasRealDb
  ? (await import('../combat/concentration-service.js')).startConcentration
  : undefined;

if (!hasRealDb) {
  console.warn('[hex] SKIPPED: set TEST_DATABASE_URL to a scratch Postgres to run these.');
}

/**
 * The d20 comes from Math.random, so the AC is moved instead of the die (same trick as
 * attack-telemetry.real-db.test.ts): AC 1 is hit except on a natural 1, and both attacks below
 * retry a bounded number of times for the hit branch.
 */
const UNMISSABLE_AC = 1;
const MAX_ATTEMPTS = 12;

type HexCarrier = {
  hit?: boolean;
  hexDamage?: number;
  hexCurse?: boolean;
  finalDamage?: number;
  isCritical?: boolean;
};
type Resolution = { results: HexCarrier[] };

describeWithDb('Hex (#754)', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = testId('hex-user');

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let warlockId: string;
  let cursedId: string;
  let bystanderId: string;

  beforeAll(async () => {
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('hex-camp') })
      .returning({ id: campaigns.id });

    // Warlock 3, CHA 16, Hex on the sheet: the class Hex is gated to, and the sheet the
    // cast-time check reads. STR 16 so the longsword lands often.
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('warlock'),
        level: 3,
        class: 'Warlock',
        knownSpells: 'Hex, Eldritch Blast',
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      charisma: 16,
      armorClass: 12,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Warlock',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          name: 'Hexed Golem',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: UNMISSABLE_AC,
          maxHp: 500,
          speed: 30,
        },
        {
          encounterId,
          name: 'Bystander Golem',
          participantType: 'monster',
          turnOrder: 2,
          initiative: 5,
          armorClass: UNMISSABLE_AC,
          maxHp: 500,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    warlockId = inserted.find((row) => row.turnOrder === 0)!.id;
    cursedId = inserted.find((row) => row.turnOrder === 1)!.id;
    bystanderId = inserted.find((row) => row.turnOrder === 2)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: warlockId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: cursedId, currentHp: 500, maxHp: 500, isConscious: true },
      { participantId: bystanderId, currentHp: 500, maxHp: 500, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    for (const status of [
      { participantId: warlockId, currentHp: 30 },
      { participantId: cursedId, currentHp: 500 },
      { participantId: bystanderId, currentHp: 500 },
    ]) {
      await db
        .update(combatParticipantStatus)
        .set({ currentHp: status.currentHp, isConscious: true })
        .where(eq(combatParticipantStatus.participantId, status.participantId));
    }
  });

  /** Hands the turn to `actorId`, refunds actions, and returns the version to claim. */
  const giveTurnTo = async (actorId: string): Promise<number> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, actorId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    return encounter.version;
  };

  const castHex = async (): Promise<Resolution> => {
    const expectedVersion = await giveTurnTo(warlockId);
    const resolution = (await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: warlockId,
        targetIds: [cursedId],
        spellId: 'hex',
        spellName: 'Hex',
        // A 3rd-level warlock's Pact Magic slots are 2nd level; Hex is cast from one (2014).
        slotLevel: 2,
        expectedVersion,
      },
      userId,
    )) as Resolution;
    return resolution;
  };

  /** One real weapon attack, retried until it hits (AC 1 still misses on a natural 1). */
  const attackUntilHit = async (targetId: string): Promise<HexCarrier> => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const expectedVersion = await giveTurnTo(warlockId);
      const result = (await combatAttackService!.resolveAttack(
        encounterId,
        {
          attackerId: warlockId,
          targetId,
          expectedVersion,
          attackType: 'melee',
          weaponId: 'Longsword',
        },
        userId,
      )) as HexCarrier;
      if (result.hit !== false) return result;
    }
    throw new Error(`never landed a hit on ${targetId} in ${MAX_ATTEMPTS} attempts`);
  };

  test('casting Hex claims the bonus action, spends a slot, and records the cursed target', async () => {
    const resolution = await castHex();

    expect(resolution.results[0]?.hexCurse).toBe(true);
    expect(resolution.results[0]?.finalDamage).toBe(0);

    const [warlock] = await db
      .select({
        actionUsed: combatParticipants.actionUsed,
        bonusActionUsed: combatParticipants.bonusActionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, warlockId));
    expect(warlock.bonusActionUsed).toBe(true);
    expect(warlock.actionUsed).toBe(false);

    const concentration = await getConcentration!(characterId);
    expect(concentration?.spellName).toBe('Hex');
    expect(concentration?.spellId).toBe('hex');
    expect(concentration?.targetParticipantId).toBe(cursedId);

    const slots = await db
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.reduce((total, row) => total + row.usedSlots, 0)).toBe(1);
  });

  test('a hit on the cursed target carries the 1d6 necrotic rider', async () => {
    await castHex();

    // A natural 20 doubles the rider's dice (the seeded test below expects 10
    // on a crit), so an unseeded first hit that happens to be a crit says
    // nothing about the plain 1d6 rider — keep attacking until a non-critical
    // hit lands instead of widening the range below.
    let result = await attackUntilHit(cursedId);
    while (result.isCritical) result = await attackUntilHit(cursedId);

    expect(result.hexDamage).toBeGreaterThanOrEqual(1);
    expect(result.hexDamage).toBeLessThanOrEqual(6);
  });

  test('a seeded natural 20 doubles Hex dice through resolveAttack', async () => {
    await castHex();

    setRngSeed(1);
    try {
      const result = (await combatAttackService!.resolveAttack(
        encounterId,
        {
          attackerId: warlockId,
          targetId: cursedId,
          expectedVersion: await giveTurnTo(warlockId),
          attackType: 'melee',
          weaponId: 'Longsword',
          providedD20: 20,
        },
        userId,
      )) as HexCarrier & { d20?: number; isCritical?: boolean };

      expect(result.d20).toBe(20);
      expect(result.isCritical).toBe(true);
      expect(result.hexDamage).toBe(10);
    } finally {
      setRngSeed(undefined);
    }
  });

  test('a hit on a different target carries no Hex rider', async () => {
    await castHex();

    const result = await attackUntilHit(bystanderId);

    expect(result.hexDamage).toBeUndefined();
  });

  test('without a cast there is no rider even on the intended target', async () => {
    const result = await attackUntilHit(cursedId);

    expect(result.hexDamage).toBeUndefined();
  });
  test('Hex with more than one target is refused and spends nothing (#754 FIX item 2)', async () => {
    const expectedVersion = await giveTurnTo(warlockId);
    await expect(
      combatAttackService!.resolveSpellAttack(
        encounterId,
        {
          casterId: warlockId,
          targetIds: [cursedId, bystanderId],
          spellId: 'hex',
          spellName: 'Hex',
          slotLevel: 2,
          expectedVersion,
        },
        userId,
      ),
    ).rejects.toThrow(/targets exactly one creature/);

    const [warlock] = await db
      .select({ bonusActionUsed: combatParticipants.bonusActionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, warlockId));
    expect(warlock.bonusActionUsed).toBe(false);
    expect(await getConcentration!(characterId)).toBeNull();
    const slots = await db
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
    expect(slots.reduce((total, row) => total + row.usedSlots, 0)).toBe(0);
  });

  test('a seeded natural 20 doubles Hex dice through resolveSpellAttack', async () => {
    await castHex();

    setRngSeed(1);
    try {
      const resolution = (await combatAttackService!.resolveSpellAttack(
        encounterId,
        {
          casterId: warlockId,
          targetIds: [cursedId],
          spellId: 'eldritch-blast',
          spellName: 'Eldritch Blast',
          expectedVersion: await giveTurnTo(warlockId),
          d20: 20,
        },
        userId,
      )) as Resolution;
      const result = resolution.results[0] as HexCarrier & {
        d20?: number;
        isCritical?: boolean;
      };

      expect(result.d20).toBe(20);
      expect(result.isCritical).toBe(true);
      expect(result.hexDamage).toBe(10);
    } finally {
      setRngSeed(undefined);
    }
  });
});

/**
 * The reported flow, through the real intent route (#754 task 3): a warlock casts Hex as a
 * bonus action on one scavenger, then Eldritch Blasts it and deals the 1d6 necrotic on top.
 *
 * Only authentication is faked -- `createRequestPipelineApp` is not used; the real intent route
 * is mounted on a bare Elysia app, so reference resolution, the combat attack service, the
 * concentration write and the rider are all production code against a real Postgres. A mocked
 * API is what let #2280's bad body ship, so the body posted here is the client's `spell` variant
 * exactly as `intent-schema.ts` defines it.
 */
describeWithDb('Hex live route (#754 task 3)', () => {
  let db: ReturnType<typeof realDb>;
  let app: { handle: (request: Request) => Response | Promise<Response> };
  const MAX_HP = 20;

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let encounterId: string;
  let warlockId: string;
  let scavengerId: string;

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    app = new Elysia({ prefix: '/v1/combat' }).use(intentRoutes);

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId: liveUserId, name: testId('hex-live-camp') })
      .returning({ id: campaigns.id });

    // Warlock 1, as the playtest character was: one 1st-level pact slot, Hex known.
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId: liveUserId,
        campaignId,
        name: testId('warlock'),
        level: 1,
        class: 'Warlock',
        knownSpells: 'Hex, Eldritch Blast',
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      charisma: 16,
      strength: 10,
      armorClass: 12,
      maxHitPoints: MAX_HP,
      currentHitPoints: MAX_HP,
      speed: 30,
    });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Warlock',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: MAX_HP,
          speed: 30,
        },
        {
          encounterId,
          name: 'Psychic Scavenger',
          participantType: 'monster',
          turnOrder: 1,
          initiative: 10,
          armorClass: 1,
          maxHp: 200,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });
    warlockId = inserted.find((row) => row.turnOrder === 0)!.id;
    scavengerId = inserted.find((row) => row.turnOrder === 1)!.id;

    await db.insert(combatParticipantStatus).values([
      { participantId: warlockId, currentHp: MAX_HP, maxHp: MAX_HP, isConscious: true },
      { participantId: scavengerId, currentHp: 200, maxHp: 200, isConscious: true },
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  const version = async (): Promise<number> => {
    const [encounter] = await db
      .select({ version: combatEncounters.version })
      .from(combatEncounters)
      .where(eq(combatEncounters.id, encounterId));
    return encounter.version;
  };

  const post = async (
    body: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> => {
    const response = await app.handle(
      new Request(`http://localhost/v1/combat/${encounterId}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${liveUserId}` },
        body: JSON.stringify(body),
      }),
    );
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  };

  test('casting Hex then Eldritch Blast deals the extra 1d6 necrotic', async () => {
    const hex = await post({
      source: 'player',
      origin: 'typed',
      intent: {
        type: 'spell',
        actorId: warlockId,
        targetIds: [scavengerId],
        spellId: 'hex',
        spellName: 'Hex',
        slotLevel: 1,
        expectedVersion: await version(),
      },
    });
    expect(hex.status).toBe(200);
    const hexResults = (hex.json.result as Resolution).results;
    expect(hexResults[0]?.hexCurse).toBe(true);

    const concentration = await getConcentration!(characterId);
    expect(concentration?.targetParticipantId).toBe(scavengerId);

    const blast = await post({
      source: 'player',
      origin: 'typed',
      intent: {
        type: 'spell',
        actorId: warlockId,
        targetIds: [scavengerId],
        spellId: 'eldritch-blast',
        spellName: 'Eldritch Blast',
        // A fixed face against AC 1: the attack cannot miss except on a natural 1.
        d20: 15,
        expectedVersion: await version(),
      },
    });
    expect(blast.status).toBe(200);
    const blastResults = (blast.json.result as Resolution).results;
    expect(blastResults[0]?.hexDamage).toBeGreaterThanOrEqual(1);
    expect(blastResults[0]?.hexDamage).toBeLessThanOrEqual(6);
  });
});

/**
 * Bless (#902), against the same real Postgres.
 *
 * "I cast Bless on myself" spent the slot and narrated "maintains concentration on Bless",
 * but no concentration row existed for the sheet's chip to render and no roll ever saw the
 * +1d4: the combat-spell gate refused Bless outright (no attack, save, or damage), so the
 * cast never reached the concentration producer at all. This suite drives the same real
 * entry points as the Hex suite above:
 *
 *   - `resolveSpellAttack` for the cast -> concentration row naming the blessed target
 *     (the row `overlayCharacterConcentration` reads to render the sheet's chip)
 *   - `resolveAttack` for the blessed weapon attack -> the d4 inside the total
 *   - `resolveSpellAttack` again for a save spell against a blessed creature -> the d4
 *     inside its save, and `dropConcentration` -> both the row and the die gone
 */
describeWithDb('Bless (#902)', () => {
  // Assigned in beforeAll, not captured here: the Hex suite's afterAll closes the shared
  // fixture client, so this suite re-fetches realDb() the way the live-route suite does.
  let db: ReturnType<typeof realDb>;
  const userId = testId('bless-user');

  let campaignId: string;
  let characterId: string;
  let paladinCharacterId: string;
  let warlockCharacterId: string;
  let sessionId: string;
  let encounterId: string;
  let clericId: string;
  let paladinId: string;
  let golemIds: string[] = [];

  type BlessCarrier = {
    hit?: boolean;
    blessed?: boolean;
    blessDie?: number;
    attackBonus?: number;
    totalAttackRoll?: number;
    finalDamage?: number;
  };
  type BlessResolution = { results: BlessCarrier[] };

  beforeAll(async () => {
    if (!hasRealDb) return;
    db = realDb();
    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('bless-camp') })
      .returning({ id: campaigns.id });

    // Cleric 3, WIS 16, Bless prepared: a low-level cleric like the report's, high enough
    // that the upcast test below has a real 2nd-level slot to spend (2014 full casters
    // gain those at 3rd level). STR 16 so the longsword lands against the golems' AC 1.
    [{ id: characterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('cleric'),
        level: 3,
        class: 'Cleric',
        knownSpells: 'Bless, Sacred Flame',
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      wisdom: 16,
      constitution: 14,
      armorClass: 12,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });

    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    // A second caster (Paladin 3, Bless prepared) for the two-caster test below: her Bless
    // names the cleric, so the cleric's die can only come from the targeting lookup.
    [{ id: paladinCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('paladin'),
        level: 3,
        class: 'Paladin',
        knownSpells: 'Bless',
      })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId: paladinCharacterId,
      strength: 16,
      charisma: 16,
      armorClass: 12,
      maxHitPoints: 30,
      currentHitPoints: 30,
      speed: 30,
    });

    // A warlock who never enters the encounter: the Hex-shadow test below only needs his
    // concentration row (written through startConcentration, the same producer the cast
    // path uses) naming the cleric as the cursed target.
    [{ id: warlockCharacterId }] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: testId('warlock'),
        level: 3,
        class: 'Warlock',
        knownSpells: 'Hex',
      })
      .returning({ id: characters.id });

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active' })
      .returning({ id: gameSessions.id });

    [{ id: encounterId }] = await db
      .insert(combatEncounters)
      .values({ sessionId, status: 'active', currentRound: 1, currentTurnOrder: 0, version: 1 })
      .returning({ id: combatEncounters.id });

    const inserted = await db
      .insert(combatParticipants)
      .values([
        {
          encounterId,
          characterId,
          name: 'The Cleric',
          participantType: 'player',
          turnOrder: 0,
          initiative: 20,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          characterId: paladinCharacterId,
          name: 'The Paladin',
          participantType: 'player',
          turnOrder: 1,
          initiative: 15,
          armorClass: 12,
          maxHp: 30,
          speed: 30,
        },
        {
          encounterId,
          name: 'Blessing Golem A',
          participantType: 'monster',
          turnOrder: 2,
          initiative: 10,
          armorClass: UNMISSABLE_AC,
          maxHp: 500,
          speed: 30,
        },
        {
          encounterId,
          name: 'Blessing Golem B',
          participantType: 'monster',
          turnOrder: 3,
          initiative: 5,
          armorClass: UNMISSABLE_AC,
          maxHp: 500,
          speed: 30,
        },
        {
          encounterId,
          name: 'Blessing Golem C',
          participantType: 'monster',
          turnOrder: 4,
          initiative: 1,
          armorClass: UNMISSABLE_AC,
          maxHp: 500,
          speed: 30,
        },
      ])
      .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

    clericId = inserted.find((row) => row.turnOrder === 0)!.id;
    paladinId = inserted.find((row) => row.turnOrder === 1)!.id;
    golemIds = inserted
      .filter((row) => row.turnOrder > 1)
      .sort((a, b) => a.turnOrder - b.turnOrder)
      .map((row) => row.id);

    await db.insert(combatParticipantStatus).values([
      { participantId: clericId, currentHp: 30, maxHp: 30, isConscious: true },
      { participantId: paladinId, currentHp: 30, maxHp: 30, isConscious: true },
      ...golemIds.map((participantId) => ({
        participantId,
        currentHp: 500,
        maxHp: 500,
        isConscious: true,
      })),
    ]);
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, paladinCharacterId));
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, warlockCharacterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db
      .delete(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, paladinCharacterId));
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(characters).where(eq(characters.id, paladinCharacterId));
    await db.delete(characters).where(eq(characters.id, warlockCharacterId));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await closeRealDb();
  });

  beforeEach(async () => {
    if (!hasRealDb) return;
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, characterId));
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, paladinCharacterId));
    await db
      .delete(characterConcentration)
      .where(eq(characterConcentration.characterId, warlockCharacterId));
    await db.delete(characterSpellSlots).where(eq(characterSpellSlots.characterId, characterId));
    await db
      .delete(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, paladinCharacterId));
    for (const status of [
      { participantId: clericId, currentHp: 30 },
      { participantId: paladinId, currentHp: 30 },
      ...golemIds.map((participantId) => ({ participantId, currentHp: 500 })),
    ]) {
      await db
        .update(combatParticipantStatus)
        .set({ currentHp: status.currentHp, isConscious: true })
        .where(eq(combatParticipantStatus.participantId, status.participantId));
    }
  });

  /** Hands the turn to `actorId`, refunds actions, and returns the version to claim. */
  const giveTurnTo = async (actorId: string): Promise<number> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, actorId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });
    return encounter.version;
  };

  const castBless = async (targetIds: string[], slotLevel = 1): Promise<BlessResolution> => {
    return (await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: clericId,
        targetIds,
        spellId: 'bless',
        spellName: 'Bless',
        slotLevel,
        expectedVersion: await giveTurnTo(clericId),
      },
      userId,
    )) as BlessResolution;
  };

  /** One longsword attack on a pinned d20 face, so the total's arithmetic is exact. */
  const attackWithPinnedDie = async (d20: number): Promise<BlessCarrier> => {
    return (await combatAttackService!.resolveAttack(
      encounterId,
      {
        attackerId: clericId,
        targetId: golemIds[0],
        expectedVersion: await giveTurnTo(clericId),
        attackType: 'melee',
        weaponId: 'Longsword',
        providedD20: d20,
      },
      userId,
    )) as BlessCarrier;
  };

  const usedSlots = async (): Promise<number> => {
    const slots = await db
      .select({ usedSlots: characterSpellSlots.usedSlots })
      .from(characterSpellSlots)
      .where(eq(characterSpellSlots.characterId, characterId));
    return slots.reduce((total, row) => total + row.usedSlots, 0);
  };

  test('casting Bless on herself claims the action, spends a slot, and writes the concentration row the sheet chip reads', async () => {
    const resolution = await castBless([clericId]);

    expect(resolution.results[0]?.blessed).toBe(true);
    expect(resolution.results[0]?.finalDamage).toBe(0);

    const [cleric] = await db
      .select({
        actionUsed: combatParticipants.actionUsed,
        bonusActionUsed: combatParticipants.bonusActionUsed,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, clericId));
    expect(cleric.actionUsed).toBe(true);
    expect(cleric.bonusActionUsed).toBe(false);
    expect(await usedSlots()).toBe(1);

    const concentration = await getConcentration!(characterId);
    expect(concentration?.spellName).toBe('Bless');
    expect(concentration?.spellId).toBe('bless');
    expect(concentration?.targetParticipantId).toBe(clericId);
  });

  test('the next weapon attack adds the 1d4 to its total', async () => {
    await castBless([clericId]);

    const result = await attackWithPinnedDie(10);

    expect(result.hit).toBe(true);
    expect(result.blessDie).toBeGreaterThanOrEqual(1);
    expect(result.blessDie).toBeLessThanOrEqual(4);
    expect(result.totalAttackRoll).toBe(10 + (result.attackBonus ?? 0) + (result.blessDie ?? 0));
  });

  test('without a cast there is no die', async () => {
    const result = await attackWithPinnedDie(10);

    expect(result.hit).toBe(true);
    expect(result.blessDie).toBeUndefined();
  });

  test('a blessed creature adds the d4 to its saving throw against a spell', async () => {
    // Bless the golem, then make it save against the cleric's Sacred Flame: the die must
    // show up on the SAVING creature's roll, not the caster's.
    await castBless([golemIds[0]]);

    const resolution = (await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: clericId,
        targetIds: [golemIds[0]],
        spellId: 'sacred-flame',
        spellName: 'Sacred Flame',
        expectedVersion: await giveTurnTo(clericId),
      },
      userId,
    )) as BlessResolution;

    expect(resolution.results[0]?.blessDie).toBeGreaterThanOrEqual(1);
    expect(resolution.results[0]?.blessDie).toBeLessThanOrEqual(4);
  });

  test('when concentration drops, the row and the die both go away', async () => {
    await castBless([clericId]);
    const blessed = await attackWithPinnedDie(10);
    expect(blessed.blessDie).toBeGreaterThanOrEqual(1);

    await dropConcentration!(characterId);
    expect(await getConcentration!(characterId)).toBeNull();

    const after = await attackWithPinnedDie(10);
    expect(after.blessDie).toBeUndefined();
  });

  test("a caster blessed by another caster gets the die while her own Bless names someone else", async () => {
    // The paladin's Bless names the cleric: a targeting row on the PALADIN's concentration.
    await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: paladinId,
        targetIds: [clericId],
        spellId: 'bless',
        spellName: 'Bless',
        slotLevel: 1,
        expectedVersion: await giveTurnTo(paladinId),
      },
      userId,
    );
    const paladinConcentration = await getConcentration!(paladinCharacterId);
    expect(paladinConcentration?.spellName).toBe('Bless');
    expect(paladinConcentration?.targetParticipantId).toBe(clericId);

    // The cleric's own Bless names a golem, so her own concentration row does NOT cover
    // her: the die on her attack can only arrive through the targeting lookup.
    await castBless([golemIds[0]]);
    const ownConcentration = await getConcentration!(characterId);
    expect(ownConcentration?.targetParticipantId).toBe(golemIds[0]);

    const result = await attackWithPinnedDie(10);
    expect(result.hit).toBe(true);
    expect(result.blessDie).toBeGreaterThanOrEqual(1);
    expect(result.blessDie).toBeLessThanOrEqual(4);
    expect(result.totalAttackRoll).toBe(10 + (result.attackBonus ?? 0) + (result.blessDie ?? 0));
  });

  test("a Hex row naming the blessed creature does not shadow the paladin's Bless", async () => {
    // Hex and Bless both store their one target in the concentration row's
    // targetParticipantId. The warlock's Hex names the cleric (row written through
    // startConcentration, the producer the Hex cast path uses)...
    await startConcentration!(warlockCharacterId, { name: 'Hex', id: 'hex' }, clericId);
    const hexRow = await getConcentration!(warlockCharacterId);
    expect(hexRow?.spellName).toBe('Hex');
    expect(hexRow?.targetParticipantId).toBe(clericId);

    // ...and the paladin's Bless names the same creature, through the real cast path.
    await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: paladinId,
        targetIds: [clericId],
        spellId: 'bless',
        spellName: 'Bless',
        slotLevel: 1,
        expectedVersion: await giveTurnTo(paladinId),
      },
      userId,
    );
    const paladinConcentration = await getConcentration!(paladinCharacterId);
    expect(paladinConcentration?.spellName).toBe('Bless');
    expect(paladinConcentration?.targetParticipantId).toBe(clericId);

    // Two rows now name the cleric as their target. Her attack must still get the die:
    // the targeting lookup filters to Bless rows, so the Hex row cannot be the one
    // returned and discarded.
    const result = await attackWithPinnedDie(10);
    expect(result.hit).toBe(true);
    expect(result.blessDie).toBeGreaterThanOrEqual(1);
    expect(result.blessDie).toBeLessThanOrEqual(4);
    expect(result.totalAttackRoll).toBe(10 + (result.attackBonus ?? 0) + (result.blessDie ?? 0));
  });

  test('Bless with no target, or more targets than the slot allows, is refused and spends nothing', async () => {
    await expect(castBless([])).rejects.toThrow(/needs at least one creature to bless/);
    await expect(castBless([clericId, ...golemIds], 1)).rejects.toThrow(
      /blesses at most 3 creatures/,
    );

    const [cleric] = await db
      .select({ actionUsed: combatParticipants.actionUsed })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, clericId));
    expect(cleric.actionUsed).toBe(false);
    expect(await getConcentration!(characterId)).toBeNull();
    expect(await usedSlots()).toBe(0);
  });

  test('an upcast Bless takes a fourth creature (2014: +1 target per slot above 1st)', async () => {
    const resolution = await castBless([clericId, ...golemIds], 2);

    expect(resolution.results).toHaveLength(4);
    for (const result of resolution.results) expect(result.blessed).toBe(true);
    expect(await usedSlots()).toBe(1);

    // The accepted limitation, pinned: the concentration row stores only the first
    // target, so the first target (the cleric herself) mechanically keeps the die...
    const attack = await attackWithPinnedDie(10);
    expect(attack.blessDie).toBeGreaterThanOrEqual(1);
    expect(attack.blessDie).toBeLessThanOrEqual(4);

    // ...while a later target of the same cast gets none — its save against the cleric's
    // Sacred Flame carries no die until a bless-targets store exists (see the PR body).
    const flame = (await combatAttackService!.resolveSpellAttack(
      encounterId,
      {
        casterId: clericId,
        targetIds: [golemIds[1]],
        spellId: 'sacred-flame',
        spellName: 'Sacred Flame',
        expectedVersion: await giveTurnTo(clericId),
      },
      userId,
    )) as BlessResolution;
    expect(flame.results[0]?.blessDie).toBeUndefined();
  });
});
