/* eslint-disable max-lines -- one fixture chain (starter bible -> campaign -> character ->
   session -> encounter) shared by every assertion; splitting it would mean starting combat
   three times to make the same three points. */
/**
 * A monster fights with the numbers its stat block gives it — end to end, through the real
 * combat-start path and the real attack resolver.
 *
 * The unit tests beside `monster-attack-profile.ts` prove the catalog is parsed correctly.
 * They cannot prove the parse ever reaches an attack, and that is where every previous
 * version of this bug lived: the stat ladder had been reading hit points and armour class
 * correctly for two waves while `getEquippedWeaponProfile` quietly returned an unarmed strike
 * for the same creature, so a CR 10 golem with a correct 178 HP still swung at +2 for 1.
 *
 * So these go through `CombatEncounterService.startCombat` (which resolves and stores the
 * profile) and `combatAttackService.resolveAttack` (which reads it), and assert on the
 * engine's own `COMBAT_ATTACK_RESOLVED` telemetry — the same line a production log carries.
 *
 * Real database throughout. The profile is a jsonb column written by one service and read by
 * another; a mocked `db` returns whatever the test author assumed that round-trip does, which
 * is precisely the assumption worth testing.
 *
 * Requires TEST_DATABASE_URL or DATABASE_URL — see fixtures/real-db.ts. This suite refuses every
 * target except the dedicated CI Postgres at 127.0.0.1:55432 because it deletes stale fixtures
 * before setup.
 */
import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';

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
  campaignChunks,
  campaigns,
  characterStats,
  characters,
  combatEncounters,
  combatParticipantStatus,
  combatParticipants,
  gameSessions,
  inventoryItems,
  starterCampaigns,
} from '../../../../db/schema/index';
import {
  displayNameFromRoster,
  rosterEntryForParticipant,
} from '../../../../shared/engine-display-name';

type LogPayload = Record<string, unknown>;

const DEDICATED_REAL_DB_HOST = '127.0.0.1';
const DEDICATED_REAL_DB_PORT = '55432';
const MONSTER_ATTACK_FIXTURE_OWNER_PREFIX = 'monster-attack-user-';
const MONSTER_ATTACK_FIXTURE_OWNER_PATTERN = `${MONSTER_ATTACK_FIXTURE_OWNER_PREFIX}%`;

/**
 * This suite writes and deletes fixture rows, so a loopback-only allowlist is safer than trying
 * to recognize every possible production hostname. Keep the check before realDb() and before
 * importing the combat services: a misconfigured URL must fail before fixture cleanup can run.
 */
export function assertSafeMonsterAttackDatabase(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      '[monster-attacks] refusing real-DB fixtures: invalid URL; use the dedicated Postgres at 127.0.0.1:55432',
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
      `[monster-attacks] refusing real-DB fixtures against ${target}; use the dedicated Postgres at 127.0.0.1:55432`,
    );
  }
}

export function monsterAttackFixtureOwner(runMarker: string): string {
  return `${MONSTER_ATTACK_FIXTURE_OWNER_PREFIX}${runMarker}`;
}

type RealDb = ReturnType<typeof realDb>;

/** Remove rows left by a crashed prior run before this run inserts anything. */
export async function preCleanMonsterAttackFixtures(db: RealDb): Promise<void> {
  await db.delete(characters).where(like(characters.userId, MONSTER_ATTACK_FIXTURE_OWNER_PATTERN));
}

if (hasRealDb) assertSafeMonsterAttackDatabase(realDbUrl);

const emitted: LogPayload[] = [];
const profileLogs: LogPayload[] = [];
const fallbackLogs: LogPayload[] = [];
const npcFallbackLogs: LogPayload[] = [];

const record = (payload: LogPayload): void => {
  if (payload.msg === 'COMBAT_ATTACK_RESOLVED') emitted.push(payload);
  if (payload.msg === 'COMBAT_MONSTER_ATTACK_PROFILE') profileLogs.push(payload);
  if (payload.msg === 'COMBAT_MONSTER_ATTACK_FALLBACK') fallbackLogs.push(payload);
  if (payload.msg === 'NPC_STAT_FALLBACK') npcFallbackLogs.push(payload);
};

const info = mock(record);
const warn = mock(record);

// Every export is stubbed: `mock.module` replaces the module for every importer in the run,
// so a missing child logger becomes a hard "Export named 'combatLogger' not found" in some
// unrelated file.
const stub = () => ({
  info,
  warn,
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
}));

const { CombatEncounterService } = await importWithRealDb(
  () => import('../combat/combat-encounter-service.js'),
);
const { combatAttackService } = await importWithRealDb(
  () => import('../combat/combat-attack-service.js'),
);
const { deriveCombatEntryFirstAction } = await importWithRealDb(
  () => import('../combat/combat-entry-first-action.js'),
);
const { clearCampaignMonsterCache } = await importWithRealDb(
  () => import('../combat/campaign-monster-resolution.js'),
);

if (!hasRealDb) {
  console.warn(
    '[monster-attacks] SKIPPED: set TEST_DATABASE_URL to the dedicated Postgres at 127.0.0.1:55432 to run these.',
  );
}

test('refuses a non-dedicated database target before fixture cleanup', () => {
  expect(() =>
    assertSafeMonsterAttackDatabase('postgres://prod.example.test:5432/postgres'),
  ).toThrow('refusing real-DB fixtures');
});

test('accepts the dedicated CI database target', () => {
  expect(() =>
    assertSafeMonsterAttackDatabase('postgres://postgres:postgres@127.0.0.1:55432/postgres'),
  ).not.toThrow();
});

test('gives each run a stable owner prefix for startup pre-clean', () => {
  expect(monsterAttackFixtureOwner('run-123')).toBe('monster-attack-user-run-123');
  expect(MONSTER_ATTACK_FIXTURE_OWNER_PATTERN).toBe('monster-attack-user-%');
});

test('pre-clean issues one character deletion before fixture setup', async () => {
  const where = mock(() => Promise.resolve());
  const deleteFrom = mock(() => ({ where }));

  await preCleanMonsterAttackFixtures({ delete: deleteFrom } as unknown as RealDb);

  expect(deleteFrom).toHaveBeenCalledWith(characters);
  expect(where).toHaveBeenCalledTimes(1);
});

/**
 * The Stone Golem's printed line, quoted from `src/data/srd/monsters.json` so a drift in the
 * catalog fails these tests rather than silently changing what they assert:
 *
 *   "Melee Weapon Attack: +10 to hit, reach 5 ft., one target.
 *    Hit: 19 (3d8 + 6) bludgeoning damage."
 */
const STONE_GOLEM = {
  attackBonus: 10,
  damageDice: '3d8',
  damageBonus: 6,
  damageType: 'bludgeoning',
};

/** A bible creature in the shape bibles actually ship: HP and AC, abilities as prose. */
const GLUTEN_GOLEM_CHUNK = [
  '**Gluten Golem**',
  '',
  '**HP:** 90 **AC:** 14 **Speed:** 30ft',
  '',
  '**Abilities:** Rising Dough — the golem swells when heated.',
].join('\n');

/**
 * The same creature, but with an attack line authored. Used only for the precedence test.
 *
 * The `+` on the attack bonus is required, not decorative: `authored-stat-block-parser`
 * insists on it so that an attack line reading "Attack: slam" cannot be read as +0. A bible
 * writing a bare `7` gets no authored bonus and falls through to the derived rung — which is
 * the parser behaving correctly, and worth knowing when auditing bible coverage.
 */
const AUTHORED_ATTACKER_CHUNK = [
  '**Authored Attacker**',
  '',
  '**HP:** 90 **AC:** 14 **Speed:** 30ft',
  '**Attack Bonus:** +7',
  '**Damage:** 2d10+4 fire',
].join('\n');

/**
 * Captain Sarah Reeves as the lore-keeper chunker emits her (npc_tier1, entity name without the
 * list number), with the block content PR infinite-realms-clean #18 adds under the NPC entry.
 * Traced with the real `chunkCampaignFiles` on her bible entry; see the PR description.
 */
const REEVES_CHUNK = [
  '**2. Captain Sarah Reeves** (Human Fighter) - Stoic, scarred, pragmatic.',
  '*   **Voice:** Low, raspy, clipped military cadence. No contractions.',
  '*   **Goal:** Extract as many living people as possible.',
  '*   **Secret:** She is already infected by the Spores; her left arm is numb.',
  '*   *HP:* 45, *AC:* 15 (chain shirt).',
  '*   *Attack:* +3 to hit, 1d8 slashing (longsword)',
].join('\n');

/** An NPC bio with no block, today's norm for every bible NPC. */
const QUILL_CHUNK = [
  '**Quill** (Human Scribe) - Nervous, ink-stained.',
  '*   **Voice:** Whispers.',
  '*   **Goal:** Finish the ledger.',
  '*   **Secret:** Forged the last entry.',
].join('\n');

/** The Academy creature and the NPC bio that shares its normalized name (leading "The"). */
const FLAVOR_ELEMENTAL_CHUNK = [
  '**Flavor-Elemental (Corrupted)**',
  '',
  '*HP:* 80, *AC:* 14.',
  '*Attack:* +3 to hit, 2d8+2 psychic',
].join('\n');
const FLAVOR_ELEMENTAL_NPC_BIO = [
  '**The Flavor-Elemental (Corrupted)** (Elemental) - Discordant.',
  '*   **Voice:** A cacophony of tastes.',
  '*   **Goal:** Spread corruption.',
].join('\n');

/**
 * Four player characters, deliberately.
 *
 * This suite asserts that a creature swings the numbers ITS STAT BLOCK PRINTS, and every
 * published stat block is priced for a party of four (see `party-scaling.ts`). At a party of
 * four the scaling factor is 1.00 and the block is used verbatim, so the assertions below stay
 * assertions about the stat ladder rather than about the scaler. Party scaling has its own
 * suite; conflating the two would leave neither provable.
 */
const PARTY_SIZE = 4;

describeWithDb('monsters attack with their own numbers', () => {
  const db = hasRealDb ? realDb() : (null as never);
  const userId = monsterAttackFixtureOwner(testId('run'));
  const starterCampaignId = testId('bible');

  let campaignId: string;
  let characterId: string;
  const companionIds: string[] = [];
  let sessionId: string;
  let encounterId: string;
  let heroId: string;
  const ids: Record<string, string> = {};

  const NAMES = {
    hero: 'Attack Hero',
    stoneGolem: 'Stone Golem',
    glutenGolem: 'Gluten Golem',
    authored: 'Authored Attacker',
    improvised: 'The Doorkeeper',
    reeves: 'Captain Sarah Reeves',
    quill: 'Quill',
    shardA: 'Corrupted Shard A',
    shardB: 'Corrupted Shard B',
  };

  beforeAll(async () => {
    await preCleanMonsterAttackFixtures(db);

    [{ id: campaignId }] = await db
      .insert(campaigns)
      .values({ userId, name: testId('camp') })
      .returning({ id: campaigns.id });

    [{ id: characterId }] = await db
      .insert(characters)
      .values({ userId, campaignId, name: NAMES.hero, level: 3, class: 'Fighter' })
      .returning({ id: characters.id });

    await db.insert(characterStats).values({
      characterId,
      strength: 16,
      armorClass: 13,
      maxHitPoints: 400,
      currentHitPoints: 400,
      speed: 30,
    });
    await db
      .insert(inventoryItems)
      .values({ characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true });

    // The other three. They never act; they exist so the encounter's party size is four and
    // the scaler leaves every stat block exactly as its author printed it.
    for (let index = 1; index < PARTY_SIZE; index += 1) {
      const [row] = await db
        .insert(characters)
        .values({ userId, campaignId, name: `${NAMES.hero} Companion ${index}`, level: 3 })
        .returning({ id: characters.id });
      companionIds.push(row.id);
      await db.insert(characterStats).values({
        characterId: row.id,
        armorClass: 13,
        maxHitPoints: 400,
        currentHitPoints: 400,
        speed: 30,
      });
    }

    await db.insert(starterCampaigns).values({
      id: starterCampaignId,
      slug: starterCampaignId,
      title: 'Attack Fixture Bible',
      genre: ['fixture'],
      tone: ['diagnostic'],
      difficulty: 'medium',
      premise: 'A bible that exists only to be fought in.',
    });
    await db.insert(campaignChunks).values([
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: NAMES.glutenGolem,
        content: GLUTEN_GOLEM_CHUNK,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: NAMES.authored,
        content: AUTHORED_ATTACKER_CHUNK,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'npc_tier1' as const,
        entityName: 'Captain Sarah Reeves',
        content: REEVES_CHUNK,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'npc_tier1' as const,
        entityName: NAMES.quill,
        content: QUILL_CHUNK,
      },
      // Inserted before the monster on purpose: the bestiary entry must win either way.
      {
        campaignId: starterCampaignId,
        chunkType: 'npc_tier1' as const,
        entityName: 'The Flavor-Elemental (Corrupted)',
        content: FLAVOR_ELEMENTAL_NPC_BIO,
      },
      {
        campaignId: starterCampaignId,
        chunkType: 'monster' as const,
        entityName: 'Flavor-Elemental (Corrupted)',
        content: FLAVOR_ELEMENTAL_CHUNK,
      },
    ]);
    // The index is memoized per campaign; a stale entry from another suite would resolve
    // against a bible this test did not write.
    clearCampaignMonsterCache();

    [{ id: sessionId }] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 1, status: 'active', starterCampaignId })
      .returning({ id: gameSessions.id });

    const state = await CombatEncounterService.startCombat(
      sessionId,
      [
        { encounterId: '', characterId, name: NAMES.hero, initiativeModifier: 1 },
        ...companionIds.map((id, index) => ({
          encounterId: '',
          characterId: id,
          name: `${NAMES.hero} Companion ${index + 1}`,
          initiativeModifier: 0,
        })),
        {
          encounterId: '',
          name: NAMES.stoneGolem,
          monsterId: 'srd:stone-golem',
          initiativeModifier: 0,
        },
        {
          encounterId: '',
          name: NAMES.glutenGolem,
          monsterId: 'gluten_golem_01',
          initiativeModifier: 0,
        },
        {
          encounterId: '',
          name: NAMES.authored,
          monsterId: 'authored_attacker',
          initiativeModifier: 0,
        },
        // No monsterId and no bible entry: DM improvisation that resolves nowhere.
        { encounterId: '', name: NAMES.improvised, initiativeModifier: 0 },
        // Name-only bible NPC with an authored block, and one whose bio has none.
        { encounterId: '', name: NAMES.reeves, initiativeModifier: 0 },
        { encounterId: '', name: NAMES.quill, initiativeModifier: 0 },
        // One bestiary creature seated twice under DM-invented labels.
        {
          encounterId: '',
          name: NAMES.shardA,
          monsterId: 'flavor_elemental_corrupted',
          initiativeModifier: 0,
        },
        {
          encounterId: '',
          name: NAMES.shardB,
          monsterId: 'flavor_elemental_corrupted',
          initiativeModifier: 0,
        },
      ] as Parameters<typeof CombatEncounterService.startCombat>[1],
      false,
      userId,
    );

    encounterId = state.encounter.id;
    const byName = new Map(
      state.participants.map((participant) => [participant.name, participant.id]),
    );
    heroId = byName.get(NAMES.hero)!;
    for (const [key, name] of Object.entries(NAMES)) ids[key] = byName.get(name)!;

    // Big enough that no sequence of attacks in this suite can end the encounter mid-run.
    await db
      .update(combatParticipantStatus)
      .set({ currentHp: 400, maxHp: 400 })
      .where(inArray(combatParticipantStatus.participantId, Object.values(ids)));
  });

  afterAll(async () => {
    if (!hasRealDb) return;
    await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
    await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
    await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
    await db.delete(characters).where(inArray(characters.id, [characterId, ...companionIds]));
    await db.delete(campaigns).where(eq(campaigns.id, campaignId));
    await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterCampaignId));
    clearCampaignMonsterCache();
    await closeRealDb();
  });

  beforeEach(() => {
    emitted.length = 0;
    fallbackLogs.length = 0;
  });

  const storedProfile = async (participantId: string): Promise<LogPayload | null> => {
    const [row] = await db
      .select({ profile: combatParticipants.monsterAttack })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, participantId));
    return (row?.profile as LogPayload) ?? null;
  };

  /** One real resolution, returning the engine's own telemetry line for it. */
  const attack = async (attackerId: string, targetId: string): Promise<LogPayload> => {
    const [participant] = await db
      .select({ turnOrder: combatParticipants.turnOrder })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, attackerId));
    await db
      .update(combatParticipants)
      .set({ actionUsed: false, bonusActionUsed: false })
      .where(eq(combatParticipants.encounterId, encounterId));
    const [encounter] = await db
      .update(combatEncounters)
      .set({ currentTurnOrder: participant.turnOrder, updatedAt: new Date() })
      .where(eq(combatEncounters.id, encounterId))
      .returning({ version: combatEncounters.version });

    emitted.length = 0;
    await combatAttackService.resolveAttack(
      encounterId,
      { attackerId, targetId, expectedVersion: encounter.version, attackType: 'melee' },
      userId,
    );
    expect(emitted).toHaveLength(1);
    return emitted[0];
  };

  test('a Stone Golem swings its own catalog Slam, at the values printed in monsters.json', async () => {
    const profile = await storedProfile(ids.stoneGolem);
    expect(profile?.source).toBe('catalog');
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      name: 'Slam',
      attackBonus: STONE_GOLEM.attackBonus,
      damageDice: STONE_GOLEM.damageDice,
      damageBonus: STONE_GOLEM.damageBonus,
      damageType: STONE_GOLEM.damageType,
    });

    const line = await attack(ids.stoneGolem, heroId);
    expect(line.profileSource).toBe('catalog');
    expect(line.weapon).toBe('Slam');
    // The printed +10, verbatim — not rebuilt from ability modifier + proficiency, which for a
    // participant with no ability scores would have produced the +2 this wave exists to end.
    expect(line.attackBonus).toBe(STONE_GOLEM.attackBonus);
    expect(line.totalAttack).toBe(Number(line.d20) + STONE_GOLEM.attackBonus);
    if (line.outcome === 'hit' && !line.critical) {
      // 3d8+6 spans 9..30. The old generic profile could only ever produce 1.
      expect(line.damageRolled as number).toBeGreaterThanOrEqual(9);
      expect(line.damageRolled as number).toBeLessThanOrEqual(30);
    }
  });

  test('the profile resolution is logged with its rung, and names the Multiattack it cannot express', async () => {
    const logged = profileLogs.find((entry) => entry.combatantName === NAMES.stoneGolem);
    expect(logged).toBeDefined();
    expect(logged!.attackSource).toBe('catalog');
    expect(logged!.statSource).toBe('srd');
    expect(logged!.attack).toBe('Slam +10, 3d8+6 bludgeoning');
    // The shortfall is stated rather than hidden: the golem should make two slams a turn.
    expect(String(logged!.multiattackNotExpressed)).toContain('two slam attacks');
    expect(logged!.unsupportedActions).toContain('Slow (saving-throw ability)');
  });

  test('a campaign creature with HP and no attack line gets a derived attack, logged as derived', async () => {
    const profile = await storedProfile(ids.glutenGolem);
    expect(profile?.source).toBe('derived');
    // 90 authored HP sits in the DMG's CR 2 band: +3 to hit, 15-20 damage per round.
    expect(profile?.derivation).toEqual({
      fromMaxHp: 90,
      challengeRating: '2',
      damagePerRound: 17,
    });

    const line = await attack(ids.glutenGolem, heroId);
    // `derived` and not `authored`: these numbers were inferred from hit points because the
    // bible wrote none, and the telemetry has to keep that distinction visible.
    expect(line.profileSource).toBe('derived');
    expect(line.attackBonus).toBe(3);
    if (line.outcome === 'hit' && !line.critical) {
      // 5d6 spans 5..30 — a real attack, where the generic default gave exactly 1.
      expect(line.damageRolled as number).toBeGreaterThanOrEqual(5);
      expect(line.damageApplied as number).toBeGreaterThan(1);
    }

    const logged = profileLogs.find((entry) => entry.combatantName === NAMES.glutenGolem);
    expect(logged!.attackSource).toBe('derived');
    // The creature's STATS are authored while its ATTACK is inferred. Reporting one label for
    // both would claim the bible supplied an attack it never wrote.
    expect(logged!.statSource).toBe('campaign');
    expect(logged!.derivation).toMatchObject({ fromMaxHp: 90, challengeRating: '2' });
  });

  test('an authored attack line beats the derivation for the same creature', async () => {
    const profile = await storedProfile(ids.authored);
    expect(profile?.source).toBe('authored');
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      attackBonus: 7,
      damageDice: '2d10',
      damageBonus: 4,
      damageType: 'fire',
    });

    const line = await attack(ids.authored, heroId);
    expect(line.profileSource).toBe('authored');
    expect(line.attackBonus).toBe(7);
  });

  test('an NPC that resolves nowhere fights on an HP-derived attack, and the fallback is logged once', async () => {
    const profile = await storedProfile(ids.improvised);
    // No HP anywhere: the documented default (20 HP), house band CR 1/8 => +3, 1d6.
    expect(profile?.source).toBe('derived');
    expect(profile?.derivation).toMatchObject({ fromMaxHp: 20, challengeRating: '1/8' });
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      attackBonus: 3,
      damageDice: '1d6',
    });

    const line = await attack(ids.improvised, heroId);
    expect(line.profileSource).toBe('derived');
    expect(line.attackBonus).toBe(3);

    // One line for the whole encounter, not one per improvised seat; it names both NPCs with
    // no block and neither the authored NPC nor any bestiary creature.
    expect(npcFallbackLogs).toHaveLength(1);
    expect(npcFallbackLogs[0]).toMatchObject({
      encounterId,
      reason: 'no_authored_block_default_hp',
    });
    const seats = npcFallbackLogs[0]!.seats as LogPayload[];
    expect(seats.map((seat) => seat.npcName).sort()).toEqual(
      [NAMES.improvised, NAMES.quill].sort(),
    );
    // The old generic path (1d1 Unarmed Strike) is gone for these seats.
    expect(fallbackLogs.find((entry) => entry.combatantName === NAMES.improvised)).toBeUndefined();
  });

  test('a bible NPC with an authored block fights on it, and never reaches the fallback', async () => {
    const profile = await storedProfile(ids.reeves);
    expect(profile?.source).toBe('authored');
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      attackBonus: 3,
      damageDice: '1d8',
      damageBonus: 0,
      damageType: 'slashing',
    });
    const [seat] = await db
      .select({ maxHp: combatParticipants.maxHp, armorClass: combatParticipants.armorClass })
      .from(combatParticipants)
      .where(eq(combatParticipants.id, ids.reeves));
    expect(seat).toEqual({ maxHp: 45, armorClass: 15 });

    const line = await attack(ids.reeves, heroId);
    expect(line.profileSource).toBe('authored');
    expect(line.attackBonus).toBe(3);
    const seats = npcFallbackLogs[0]!.seats as LogPayload[];
    expect(seats.map((entry) => entry.npcName)).not.toContain(NAMES.reeves);
  });

  test('an NPC bio never shadows the bestiary creature of the same normalized name', async () => {
    const profile = await storedProfile(ids.shardA);
    expect(profile?.source).toBe('authored');
    expect((profile?.attacks as LogPayload[])[0]).toMatchObject({
      attackBonus: 3,
      damageDice: '2d8',
      damageBonus: 2,
      damageType: 'psychic',
    });
  });

  test('two seats of one bestiary creature keep the DM labels as names and show numbered headings', async () => {
    expect(ids.shardA).toBeDefined();
    expect(ids.shardB).toBeDefined();
    expect(ids.shardA).not.toBe(ids.shardB);
    const names = await db
      .select({ id: combatParticipants.id, name: combatParticipants.name })
      .from(combatParticipants)
      .where(inArray(combatParticipants.id, [ids.shardA, ids.shardB]));
    expect(names.map((row) => row.name).sort()).toEqual([NAMES.shardA, NAMES.shardB]);

    const a = await storedProfile(ids.shardA);
    const b = await storedProfile(ids.shardB);
    expect(new Set([a?.displayName, b?.displayName])).toEqual(
      new Set(['Flavor-Elemental (Corrupted) 1', 'Flavor-Elemental (Corrupted) 2']),
    );
    // What players read, through the shared roster rule the engine lines use.
    const roster = [
      rosterEntryForParticipant({ id: ids.shardA, name: NAMES.shardA, monsterAttack: a }),
      rosterEntryForParticipant({ id: ids.shardB, name: NAMES.shardB, monsterAttack: b }),
    ];
    expect(displayNameFromRoster(ids.shardA, roster)).toBe(a?.displayName as string);
    // ... and a reference by the DM's own label still finds the same seat.
    expect(displayNameFromRoster(NAMES.shardB, roster)).toBe(b?.displayName as string);
  });

  test('a DM declaration by the original label resolves to the right seat', async () => {
    const participants = await db
      .select()
      .from(combatParticipants)
      .where(eq(combatParticipants.encounterId, encounterId));
    const deps = {
      listEquippedWeaponProfiles: async () => [],
      getParticipantAbilityProfile: async () => ({
        level: 3,
        savingThrowProficiencies: [],
        scores: { str: 16 },
        saveBonuses: {},
        spellIds: [],
      }),
      getActiveConditionNames: async () => [],
      loadActiveTacticalMap: async () => null,
      logger: { warn: () => {} },
    } as unknown as Parameters<typeof deriveCombatEntryFirstAction>[1];

    for (const [label, expected] of [
      [NAMES.shardA, ids.shardA],
      [NAMES.shardB, ids.shardB],
    ] as const) {
      const action = await deriveCombatEntryFirstAction(
        {
          sessionId,
          combatState: { encounter: { id: encounterId }, participants: participants as never },
          player: { characterId, name: NAMES.hero },
          declaredAttack: {
            verb: 'attack',
            actorName: label,
            monsterId: 'flavor_elemental_corrupted',
          },
        },
        deps,
      );
      expect(action?.target).toBe(expected);
    }
  });

  test('a solo party with a supplied hpMax derives from RAW hp, then scales the derived profile', async () => {
    const [soloSession] = await db
      .insert(gameSessions)
      .values({ campaignId, characterId, sessionNumber: 2, status: 'active', starterCampaignId })
      .returning({ id: gameSessions.id });
    npcFallbackLogs.length = 0;
    const state = await CombatEncounterService.startCombat(
      soloSession.id,
      [
        { encounterId: '', characterId, name: NAMES.hero, initiativeModifier: 1 },
        { encounterId: '', name: 'Sergeant Holt', hpMax: 100, initiativeModifier: 0 },
      ] as Parameters<typeof CombatEncounterService.startCombat>[1],
      false,
      userId,
    );
    try {
      const holt = state.participants.find((participant) => participant.name === 'Sergeant Holt')!;
      // 100 raw HP -> band CR 2 (+3, 17/round); 1 of 4 => factor 0.25 => 25 HP.
      expect(holt.maxHp).toBe(25);
      const profile = (holt as unknown as { monsterAttack: LogPayload }).monsterAttack;
      expect(profile.source).toBe('derived');
      expect(profile.derivation).toMatchObject({ fromMaxHp: 100, challengeRating: '2' });
      expect(profile.partyScaling).toMatchObject({
        partySize: 1,
        factor: 0.25,
        rawMaxHp: 100,
        scaledMaxHp: 25,
      });
      expect(npcFallbackLogs).toHaveLength(1);
      expect(npcFallbackLogs[0]).toMatchObject({ reason: 'no_authored_block_hp_derived' });
    } finally {
      await db
        .delete(combatParticipants)
        .where(eq(combatParticipants.encounterId, state.encounter.id));
      await db.delete(combatEncounters).where(eq(combatEncounters.id, state.encounter.id));
      await db.delete(gameSessions).where(eq(gameSessions.id, soloSession.id));
    }
  });

  test('player attacks are untouched by any of this', async () => {
    const line = await attack(heroId, ids.stoneGolem);
    // Still built from the character sheet: STR 16 (+3) + proficiency at level 3 (+2) = +5,
    // with a longsword's 1d8. No fixed bonus is ever set on a player weapon.
    expect(line.profileSource).toBe('character-sheet');
    expect(line.weapon).toBe('Longsword');
    expect(line.attackBonus).toBe(5);
    if (line.outcome === 'hit' && !line.critical) {
      expect(line.damageRolled as number).toBeGreaterThanOrEqual(4); // 1d8 + 3
      expect(line.damageRolled as number).toBeLessThanOrEqual(11);
    }
  });
});
