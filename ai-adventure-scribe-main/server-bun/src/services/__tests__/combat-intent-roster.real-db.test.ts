/* eslint-disable max-lines -- the real-DB fixture and end-to-end path are one contract. */
/**
 * #1943 PR A: the player-intent roster must survive the real database round trip.
 *
 * The roster joins the narrative ledger to campaign NPCs before the pure detector turns a
 * player declaration into a pending entry. This suite then carries that pending entry through
 * the real seating path and checks the rows written by the combat engine.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL. Fixture writes are allowed only against the
 * dedicated Postgres at 127.0.0.1:55432; see fixtures/real-db.ts.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { eq, like } from 'drizzle-orm';

import {
  closeRealDb,
  describeWithDb,
  hasRealDb,
  importWithRealDb,
  realDb,
  realDbUrl,
  testId,
} from './fixtures/real-db.js';
import {
  campaigns,
  characterStats,
  characters,
  combatParticipants,
  gameSessions,
  narrativeFacts,
  npcs,
} from '../../../../db/schema/index';

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const FIXTURE_OWNER_PREFIX = 'combat-intent-roster-user-';

export function assertSafeCombatIntentRosterDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[combat-intent-roster] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
    );
  }

  const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (
    !isPostgres ||
    parsed.hostname !== DEDICATED_REAL_DB_HOST ||
    parsed.port !== DEDICATED_REAL_DB_PORT
  ) {
    const target = parsed.hostname ? `${parsed.hostname}:${parsed.port || '(default)'}` : 'unknown';
    throw new Error(
      `[combat-intent-roster] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

if (hasRealDb) assertSafeCombatIntentRosterDatabase(realDbUrl);

type RealDb = ReturnType<typeof realDb>;

/** Remove only this suite's owner-scoped rows left by a crashed prior run. */
export async function preCleanCombatIntentRosterFixtures(database: RealDb): Promise<void> {
  await database.delete(characters).where(like(characters.userId, `${FIXTURE_OWNER_PREFIX}%`));
  await database.delete(campaigns).where(like(campaigns.userId, `${FIXTURE_OWNER_PREFIX}%`));
}

const { loadCombatIntentActorRoster } = await importWithRealDb(
  () => import('../combat/combat-intent-roster.js'),
);
const { detectDeclaredAttack } = await importWithRealDb(
  () => import('../combat/combat-intent-gate.js'),
);
const { applyCombatEntryGate } = await importWithRealDb(
  () => import('../combat-entry-pipeline.js'),
);
const { seatCombatEntry } = await importWithRealDb(() => import('../combat/combat-entry-gate.js'));
const { combatEntryGateDeps } = await importWithRealDb(
  () => import('../combat/combat-entry-gate-deps.js'),
);

if (!hasRealDb) {
  console.warn(
    '[combat-intent-roster] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run this suite.',
  );
}

test('refuses a non-dedicated database target before fixture setup', () => {
  expect(() =>
    assertSafeCombatIntentRosterDatabase('postgres://prod.example.test:5432/postgres'),
  ).toThrow('refusing real-DB fixtures');
});

test('accepts the dedicated CI database target', () => {
  expect(() =>
    assertSafeCombatIntentRosterDatabase('postgres://postgres:postgres@127.0.0.1:55432/postgres'),
  ).not.toThrow();
});

describeWithDb('combat intent roster and player-intent seating', () => {
  const database = hasRealDb ? realDb() : (null as never as RealDb);
  const userId = testId(FIXTURE_OWNER_PREFIX);

  let campaignId: string;
  let characterId: string;
  let sessionId: string;
  let campaignNpcId: string;

  beforeAll(async () => {
    await preCleanCombatIntentRosterFixtures(database);

    [{ id: campaignId }] = await database
      .insert(campaigns)
      .values({ userId, name: testId('combat-intent-roster-campaign') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await database
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: 'Roster Player',
        class: 'Fighter',
        level: 1,
      })
      .returning({ id: characters.id });

    await database.insert(characterStats).values({
      characterId,
      dexterity: 16,
      armorClass: 14,
      maxHitPoints: 20,
      currentHitPoints: 20,
      speed: 30,
    });

    [{ id: sessionId }] = await database
      .insert(gameSessions)
      .values({
        campaignId,
        characterId,
        sessionNumber: 1,
        status: 'active',
        summary: 'Combat intent roster test session.',
      })
      .returning({ id: gameSessions.id });

    [{ id: campaignNpcId }] = await database
      .insert(npcs)
      .values({ campaignId, name: 'Campaign Sentinel' })
      .returning({ id: npcs.id });

    await database.insert(narrativeFacts).values({
      sessionId,
      campaignId,
      subjectType: 'npc',
      subjectName: 'ledger warden',
      predicate: 'identity',
      value: { name: 'Ledger Warden', state: 'hostile' },
      source: 'engine',
      knownBy: ['dm'],
      needsReview: false,
    });
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    try {
      if (sessionId) await database.delete(gameSessions).where(eq(gameSessions.id, sessionId));
      if (characterId) await database.delete(characters).where(eq(characters.id, characterId));
      if (campaignId) await database.delete(campaigns).where(eq(campaigns.id, campaignId));
    } finally {
      await closeRealDb();
    }
  });

  test('loads the seeded roster and seats a player_intent entry through the real combat path', async () => {
    const roster = await loadCombatIntentActorRoster(sessionId, userId);

    expect(roster).toEqual([
      { name: 'Ledger Warden' },
      { name: 'Campaign Sentinel', actorSlug: campaignNpcId, campaignOnly: true },
    ]);

    const declaredAttack = detectDeclaredAttack('I punch Ledger Warden', roster);
    expect(declaredAttack).toEqual({
      verb: 'punch',
      actorName: 'Ledger Warden',
      attackSource: 'unarmed',
      weaponStated: false,
    });

    const player = {
      characterId,
      name: 'Roster Player',
      // The engine must use stored DEX, not this caller-controlled value.
      initiativeModifier: 99,
    };
    const gated = await applyCombatEntryGate({
      result: { text: 'The room tightens around the first blow.' } as never,
      userId,
      combatEntry: { sessionId, player },
      declaredAttack,
    });
    const envelope = JSON.parse(gated.text) as {
      combat_entry_pending?: {
        trigger: 'player_intent';
        detail: string;
        combatants: Array<{ name: string; count: number; monsterId?: string }>;
        sceneSpec: unknown;
        sceneSpecSynthesized: boolean;
        declaredAttack: NonNullable<typeof declaredAttack>;
      };
    };
    const pending = envelope.combat_entry_pending;

    expect(pending).toMatchObject({
      trigger: 'player_intent',
      combatants: [{ name: 'Ledger Warden', count: 1 }],
    });
    if (!pending) throw new Error('player_intent pending entry was not produced');

    const outcome = await seatCombatEntry(
      {
        sessionId,
        userId,
        player,
        combatants: pending.combatants,
        sceneSpec: pending.sceneSpec as Parameters<typeof seatCombatEntry>[0]['sceneSpec'],
        sceneSpecSynthesized: pending.sceneSpecSynthesized,
        trigger: pending.trigger,
        detail: pending.detail,
        playerInitiativeRoll: 13,
        declaredAttack: pending.declaredAttack,
      },
      combatEntryGateDeps,
    );

    expect(outcome).toMatchObject({
      entered: true,
      trigger: 'player_intent',
      participantCount: 2,
      seatingTranscript: expect.stringContaining('You: 13 + 3 = 16'),
    });
    if (!outcome) throw new Error('player_intent seating did not return an outcome');

    const participants = await database
      .select({
        id: combatParticipants.id,
        name: combatParticipants.name,
        characterId: combatParticipants.characterId,
        participantType: combatParticipants.participantType,
        initiative: combatParticipants.initiative,
        initiativeModifier: combatParticipants.initiativeModifier,
      })
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, outcome.encounterId));

    expect(participants).toHaveLength(2);
    expect(participants).toContainEqual({
      id: expect.any(String),
      name: 'Roster Player',
      characterId,
      participantType: 'player',
      initiative: 16,
      initiativeModifier: 3,
    });
    expect(participants).toContainEqual({
      id: expect.any(String),
      name: 'Ledger Warden',
      characterId: null,
      participantType: 'monster',
      initiativeModifier: expect.any(Number),
      initiative: expect.any(Number),
    });
    expect(outcome.firstAction).toMatchObject({
      type: 'attack',
      source: 'unarmed',
      roll_request: { modifier: 2 },
    });
    expect(outcome.firstAction?.actor).toBe(
      participants.find((participant) => participant.characterId === characterId)?.id,
    );
    expect(outcome.firstAction?.target).toBe(
      participants.find((participant) => participant.name === 'Ledger Warden')?.id,
    );
  });
});
