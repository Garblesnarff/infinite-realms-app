#!/usr/bin/env bun
/* eslint-disable no-console -- a CLI diagnostic whose entire output is its console report. */
/* eslint-disable max-lines -- one self-contained diagnostic: fixture, scenarios and report
   formatting belong together, as in the sibling audit and backfill scripts. */
/**
 * Deterministic combat harness.
 *
 * Answers combat questions in one minute instead of one 30-turn LLM playtest.
 *
 * Sixteen agent playtests were run to answer three questions about attack resolution, and
 * six consecutive runs failed to answer any of them — not because the engine misbehaved,
 * but because a playtest is the wrong instrument. It costs three minutes and a provider
 * bill, the encounter it produces lasts ten seconds, the dice are unrepeatable, and the DM
 * decides what gets attacked. This script fixes all four: a fixed encounter with known
 * stats, a scripted sequence of attacks in both directions, and a seeded PRNG so the same
 * command prints the same numbers every time.
 *
 * It runs against a real Postgres, never a mock. That is not a preference. Every unit test
 * in this repo mocks `db`, and that is exactly how the Drizzle insert-select bug survived
 * eleven weeks across 30 call sites: the failure is a synchronous throw inside Drizzle's
 * *statement builder*, so a mocked `db` never runs the code that breaks. A harness whose
 * purpose is to tell the truth about production cannot be built on the thing that hid the
 * last three production bugs.
 *
 * It calls `combatAttackService.resolveAttack` — the same entry point the HTTP intent route
 * calls — and reads its report out of the engine's own `COMBAT_ATTACK_RESOLVED` telemetry
 * line, captured off stdout. Nothing here recomputes a roll or an AC. If the numbers below
 * are wrong, the engine is wrong.
 *
 * ---------------------------------------------------------------------------------------
 * USAGE
 *
 *   # One-time: a scratch Postgres carrying this repo's schema.
 *   createdb infinite_realms_test
 *   DATABASE_URL=postgres://localhost/infinite_realms_test bunx drizzle-kit push --force
 *
 *   # Run it.
 *   DATABASE_URL=postgres://localhost/infinite_realms_test bun scripts/combat-harness.ts
 *
 * Flags:
 *   --seed <n>    PRNG seed for damage dice (default 20260726). Same seed, same numbers.
 *   --keep        Leave the fixture rows behind for inspection instead of deleting them.
 *
 * Exit code is 0 only if every scenario resolved AND emitted a complete telemetry line.
 * ---------------------------------------------------------------------------------------
 */

import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) {
  console.error(
    'combat-harness: DATABASE_URL is required — this harness runs against a real database.\n' +
      '  createdb infinite_realms_test\n' +
      '  DATABASE_URL=postgres://localhost/infinite_realms_test bunx drizzle-kit push --force\n' +
      '  DATABASE_URL=postgres://localhost/infinite_realms_test bun scripts/combat-harness.ts',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const SEED = Number(flag('--seed') ?? 20260726);
const KEEP = argv.includes('--keep');

// ---------------------------------------------------------------------------------------
// Determinism.
//
// The engine rolls with `Math.random()`. Replacing it with a seeded PRNG here — before any
// engine module is imported — makes the whole run reproducible without the engine knowing
// it is under test, which is the point: a harness that needed an injection seam in
// production code would be testing the seam rather than the engine.
//
// Deliberately a seeded *stream* and not a per-attack forced face. Forcing was tried first
// and is quietly wrong: the resolution path issues several database round-trips before
// `rollD20`, postgres.js draws from `Math.random()` along the way, and the pinned value was
// consumed by a connection detail instead of the d20. A pinned roll that silently lands on
// the wrong call produces confident, false output — the exact failure this harness exists
// to end. The seeded stream cannot lie about which number was the d20, because the engine's
// own telemetry line reports the face it rolled.
//
// Both outcomes still get exercised: each direction attacks several times, and the report
// fails if a run produced no hit or no miss to look at.
// ---------------------------------------------------------------------------------------
const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const prng = mulberry32(SEED);
Math.random = prng;

// ---------------------------------------------------------------------------------------
// Telemetry capture.
//
// The report is read out of the engine's own log line rather than recomputed, so this
// harness doubles as proof that the line is emitted, complete, on a real resolution — hit
// and miss alike. pino writes NDJSON to stdout; we tee it.
// ---------------------------------------------------------------------------------------
type Telemetry = Record<string, unknown> & { msg?: string };
const captured: Telemetry[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    try {
      const parsed = JSON.parse(line) as Telemetry;
      if (parsed.msg === 'COMBAT_ATTACK_RESOLVED') captured.push(parsed);
    } catch {
      // Not our line. Engine logs are passed through untouched either way.
    }
  }
  return (originalWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
}) as typeof process.stdout.write;

/** Engine chatter is noise here; the report is the product. Restored around our own output. */
const quiet = <T>(work: () => T): T => {
  const write = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    for (const line of text.split('\n')) {
      if (!line.startsWith('{')) continue;
      try {
        const parsed = JSON.parse(line) as Telemetry;
        if (parsed.msg === 'COMBAT_ATTACK_RESOLVED') captured.push(parsed);
      } catch {
        /* not ours */
      }
    }
    return true;
  }) as typeof process.stdout.write;
  try {
    return work();
  } finally {
    process.stdout.write = write;
  }
};

const { and, eq } = await import('drizzle-orm');
const { db } = await import('../db/client');
const schema = await import('../db/schema/index');
const { combatAttackService } =
  await import('../server-bun/src/services/combat/combat-attack-service');
const { saveTacticalMap, deactivateTacticalMap } =
  await import('../server-bun/src/services/combat/tactical-map-store');

const {
  campaigns,
  characters,
  characterStats,
  gameSessions,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  combatDamageLog,
  inventoryItems,
  tacticalMaps,
} = schema;

// ---------------------------------------------------------------------------------------
// The fixture. Every number here is chosen so the arithmetic in the report can be checked
// by hand — that is what makes the output an answer rather than another thing to trust.
// ---------------------------------------------------------------------------------------
const HERO = {
  name: 'Harness Hero',
  level: 3, // proficiency +2
  strength: 16, // +3
  dexterity: 12,
  armorClass: 13, // the AC the monster must beat — the same 13 run 16 could not check against
  maxHp: 30,
};
const MONSTER = {
  name: 'Harness Golem',
  armorClass: 17, // Stone Golem's real AC, so a lookup regression shows up as a wrong number
  maxHp: 40,
};

const userId = `harness-${randomUUID()}`;
let campaignId = '';
let characterId = '';
let sessionId = '';
let encounterId = '';
let heroId = '';
let monsterId = '';

async function seedFixture(): Promise<void> {
  [{ id: campaignId }] = await db
    .insert(campaigns)
    .values({ userId, name: 'Combat Harness' })
    .returning({ id: campaigns.id });

  [{ id: characterId }] = await db
    .insert(characters)
    .values({ userId, campaignId, name: HERO.name, level: HERO.level, class: 'Fighter' })
    .returning({ id: characters.id });

  await db.insert(characterStats).values({
    characterId,
    strength: HERO.strength,
    dexterity: HERO.dexterity,
    armorClass: HERO.armorClass,
    maxHitPoints: HERO.maxHp,
    currentHitPoints: HERO.maxHp,
    speed: 30,
  });

  // Real equipped weapon rows, so the hero's damage dice come from the character sheet the
  // way they do in play rather than from the unarmed-strike fallback. The bow exists only so
  // the cover scenario has something that can shoot past the covering square.
  await db.insert(inventoryItems).values([
    { characterId, name: 'Longsword', itemType: 'weapon', isEquipped: true, quantity: 1 },
    { characterId, name: 'Longbow', itemType: 'weapon', isEquipped: true, quantity: 1 },
  ]);

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
        name: HERO.name,
        // 'player' is load-bearing: it is what `endCombatIfResolved` reads to decide whether
        // the fight is over. See combat-intent-service.ts.
        participantType: 'player',
        turnOrder: 0,
        initiative: 20,
        armorClass: HERO.armorClass,
        maxHp: HERO.maxHp,
        speed: 30,
      },
      {
        encounterId,
        name: MONSTER.name,
        // 'monster', not 'npc' — this is exactly what a DM-authored structured combat start
        // produces, and reproducing it faithfully is half the point of the harness.
        participantType: 'monster',
        turnOrder: 1,
        initiative: 10,
        armorClass: MONSTER.armorClass,
        maxHp: MONSTER.maxHp,
        speed: 30,
      },
    ])
    .returning({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder });

  heroId = inserted.find((row) => row.turnOrder === 0)!.id;
  monsterId = inserted.find((row) => row.turnOrder === 1)!.id;

  await db.insert(combatParticipantStatus).values([
    { participantId: heroId, currentHp: HERO.maxHp, maxHp: HERO.maxHp, isConscious: true },
    { participantId: monsterId, currentHp: MONSTER.maxHp, maxHp: MONSTER.maxHp, isConscious: true },
  ]);
}

/**
 * Places both combatants on a board. `coverBetween` drops a half-cover cell on the line
 * between them, which is the only way to make the engine's cover-adjusted AC observable:
 * without a map there is no geometry, and without geometry cover is never consulted.
 *
 * Adjacent placement (the default) keeps a melee weapon in reach. The cover scenario needs
 * them apart, so it is run with a reach the engine will accept — see `runScenarios`.
 */
async function placeOnBoard(gapCells: number, coverBetween: boolean): Promise<void> {
  const width = 12;
  const height = 5;
  const cells = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as 0 | 1 | 2 | 3,
      elevation: 0,
    })),
  );
  const heroX = 1;
  const monsterX = heroX + gapCells;
  if (coverBetween) {
    // Half cover (+2 AC) on every cell between them, so the bonus cannot depend on which
    // footprint pair the engine happens to trace.
    for (let x = heroX + 1; x < monsterX; x += 1) cells[2][x].cover = 1;
  }
  await saveTacticalMap({
    id: randomUUID(),
    sessionId,
    width,
    height,
    cells,
    entities: [
      {
        id: heroId,
        slug: 'harness-hero',
        x: heroX,
        y: 2,
        size: 'medium',
        type: 'pc',
        speedFeet: 30,
        movementRemaining: 30,
        name: HERO.name,
      },
      {
        id: monsterId,
        slug: 'harness-golem',
        x: monsterX,
        y: 2,
        size: 'medium',
        type: 'monster',
        speedFeet: 30,
        movementRemaining: 30,
        name: MONSTER.name,
      },
    ],
    round: 1,
    sceneDescription: 'combat harness',
  });
}

/** Hands the turn to `actorId` and refunds its action, so scenarios never fight each other. */
async function giveTurnTo(actorId: string): Promise<number> {
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
}

const hpOf = async (participantId: string): Promise<number> => {
  const [row] = await db
    .select({ hp: combatParticipantStatus.currentHp })
    .from(combatParticipantStatus)
    .where(eq(combatParticipantStatus.participantId, participantId));
  return row.hp;
};

type Scenario = {
  title: string;
  attackerId: () => string;
  targetId: () => string;
  intent: string;
  /** Board setup: cell gap between combatants, and whether cover sits between them. */
  gapCells: number;
  cover: boolean;
  /** Named weapon off the character sheet; omitted means the participant's first equipped. */
  weaponId?: string;
};

/** Repeats one exchange, so a direction is observed across several rolls, not just one. */
const repeat = (count: number, scenario: Scenario): Scenario[] =>
  Array.from({ length: count }, (_, index) => ({
    ...scenario,
    title: `${scenario.title} #${index + 1}`,
  }));

const SCENARIOS: Scenario[] = [
  ...repeat(4, {
    title: 'MONSTER ATTACKS PLAYER',
    intent:
      'The case run 16 could not distinguish. A monster attack that produces no damage row is ' +
      'now either a logged roll below AC (an honest miss) or a logged hit whose HP did not ' +
      'move (swallowed damage). Four rolls, so both outcomes are on the page.',
    attackerId: () => monsterId,
    targetId: () => heroId,
    gapCells: 1,
    cover: false,
  }),
  ...repeat(4, {
    title: 'PLAYER ATTACKS MONSTER',
    intent: 'Longsword off the character sheet, against the golem AC 17.',
    attackerId: () => heroId,
    targetId: () => monsterId,
    gapCells: 1,
    cover: false,
    weaponId: 'Longsword',
  }),
  ...repeat(2, {
    title: 'PLAYER ATTACKS MONSTER THROUGH HALF COVER',
    intent:
      'Cover-adjusted AC has never been checkable in production: the engine applied the bonus ' +
      'internally and reported only the final number. baseAc 17 against effectiveAc 19 is the ' +
      '+2 half-cover bonus, observable for the first time. Ranged, because a melee weapon ' +
      'cannot reach across the covering square.',
    attackerId: () => heroId,
    targetId: () => monsterId,
    gapCells: 3,
    cover: true,
    weaponId: 'Longbow',
  }),
];

type Row = {
  scenario: Scenario;
  telemetry: Telemetry | null;
  hpBefore: number;
  hpAfter: number;
  error?: string;
};

async function runScenarios(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const scenario of SCENARIOS) {
    const attacker = scenario.attackerId();
    const target = scenario.targetId();
    await placeOnBoard(scenario.gapCells, scenario.cover);
    const version = await giveTurnTo(attacker);
    const hpBefore = await hpOf(target);
    const before = captured.length;
    let error: string | undefined;
    try {
      await quiet(() =>
        combatAttackService.resolveAttack(
          encounterId,
          {
            attackerId: attacker,
            targetId: target,
            expectedVersion: version,
            // Required by the input type but never read by the resolver: the real
            // melee/ranged decision comes from the resolved weapon profile.
            attackType: scenario.weaponId === 'Longbow' ? ('ranged' as const) : ('melee' as const),
            ...(scenario.weaponId ? { weaponId: scenario.weaponId } : {}),
          },
          userId,
        ),
      );
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : String(thrown);
    }
    rows.push({
      scenario,
      telemetry: captured[before] ?? null,
      hpBefore,
      hpAfter: await hpOf(target),
      error,
    });
  }
  return rows;
}

const REQUIRED_FIELDS = [
  'encounterId',
  'attackerId',
  'attackerSlug',
  'targetId',
  'targetSlug',
  'weapon',
  'd20',
  'attackBonus',
  'totalAttack',
  'baseAc',
  'effectiveAc',
  'cover',
  'coverBonus',
  'advantage',
  'disadvantage',
  'outcome',
  'naturalOne',
  'naturalTwenty',
  'critical',
  'damageRolled',
  'damageApplied',
  'targetHpAfter',
] as const;

function report(rows: Row[]): boolean {
  let ok = true;
  console.log('\n' + '='.repeat(88));
  console.log('DETERMINISTIC COMBAT HARNESS');
  console.log('='.repeat(88));
  console.log(`seed              ${SEED}`);
  console.log(
    `database          ${String(process.env.DATABASE_URL).replace(/:[^:@/]*@/, ':***@')}`,
  );
  console.log(`session           ${sessionId}`);
  console.log(`encounter         ${encounterId}`);
  console.log(
    `player            ${HERO.name}  AC ${HERO.armorClass}  ${HERO.maxHp} HP  STR ${HERO.strength} (+3)  level ${HERO.level} (prof +2)  Longsword`,
  );
  console.log(
    `monster           ${MONSTER.name}  AC ${MONSTER.armorClass}  ${MONSTER.maxHp} HP  participant_type='monster'`,
  );

  for (const row of rows) {
    const { scenario, telemetry } = row;
    console.log('\n' + '-'.repeat(88));
    console.log(scenario.title);
    console.log(`  why: ${scenario.intent}`);
    if (row.error) {
      ok = false;
      console.log(`  ENGINE REFUSED: ${row.error}`);
      continue;
    }
    if (!telemetry) {
      ok = false;
      console.log(
        '  NO TELEMETRY LINE EMITTED — this is the failure this harness exists to catch.',
      );
      continue;
    }
    const missing = REQUIRED_FIELDS.filter((field) => !(field in telemetry));
    const hit = telemetry.outcome === 'hit';
    console.log(
      `  ${telemetry.attackerSlug} -> ${telemetry.targetSlug}   weapon ${telemetry.weapon}`,
    );
    console.log(
      `  roll              d20 ${telemetry.d20} ${Number(telemetry.attackBonus) >= 0 ? '+' : ''}${telemetry.attackBonus} = ${telemetry.totalAttack}`,
    );
    console.log(
      `  AC compared       base ${telemetry.baseAc} + cover ${telemetry.coverBonus} (grade ${telemetry.cover}) = ${telemetry.effectiveAc}`,
    );
    console.log(
      `  outcome           ${String(telemetry.outcome).toUpperCase()}  (${telemetry.totalAttack} ${hit ? '>=' : '<'} ${telemetry.effectiveAc})${telemetry.critical ? '  CRITICAL' : ''}`,
    );
    console.log(
      `  adv/disadv        advantage=${telemetry.advantage} disadvantage=${telemetry.disadvantage}`,
    );
    console.log(
      `  damage            rolled ${telemetry.damageRolled ?? '—'}  applied ${telemetry.damageApplied ?? '—'}`,
    );
    console.log(
      `  target HP         ${row.hpBefore} -> ${row.hpAfter}  (delta ${row.hpAfter - row.hpBefore}, engine reported ${telemetry.targetHpAfter ?? '—'})`,
    );
    if (missing.length) {
      ok = false;
      console.log(`  INCOMPLETE TELEMETRY — missing: ${missing.join(', ')}`);
    }
    // A hit whose HP did not move is the silently-swallowed-damage failure mode. Naming it
    // here is the whole reason the harness reads HP from the database rather than from the
    // engine's own return value.
    if (hit && Number(telemetry.damageApplied) > 0 && row.hpAfter === row.hpBefore) {
      ok = false;
      console.log('  DAMAGE APPLIED BUT HP UNCHANGED — damage is being swallowed.');
    }
    if (!hit && row.hpAfter !== row.hpBefore) {
      ok = false;
      console.log('  MISS CHANGED HP — a miss must not move the target.');
    }
  }

  // A run that produced only hits proves nothing about the case that has been invisible for
  // sixteen playtests. Both outcomes must appear, or the run is not evidence.
  const outcomes = rows.map((row) => row.telemetry?.outcome).filter(Boolean);
  const hits = outcomes.filter((outcome) => outcome === 'hit').length;
  const misses = outcomes.filter((outcome) => outcome === 'miss').length;
  const covered = rows.filter((row) => Number(row.telemetry?.coverBonus) > 0).length;

  console.log('\n' + '-'.repeat(88));
  console.log(`observed          ${hits} hit(s), ${misses} miss(es), ${covered} through cover`);
  if (!misses) {
    ok = false;
    console.log(
      '  NO MISS OBSERVED — rerun with a different --seed; a miss is the case that matters.',
    );
  }
  if (!hits) {
    ok = false;
    console.log('  NO HIT OBSERVED — rerun with a different --seed.');
  }
  if (!covered) {
    ok = false;
    console.log('  NO COVER-ADJUSTED AC OBSERVED — the cover scenario did not reach the engine.');
  }

  console.log('\n' + '='.repeat(88));
  console.log(ok ? 'PASS — every scenario resolved and logged completely.' : 'FAIL — see above.');
  console.log('='.repeat(88) + '\n');
  return ok;
}

async function cleanup(): Promise<void> {
  await deactivateTacticalMap(sessionId).catch(() => {});
  await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
  await db.delete(combatDamageLog).where(eq(combatDamageLog.encounterId, encounterId));
  for (const participantId of [heroId, monsterId]) {
    await db
      .delete(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
  }
  await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
  await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
  await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
  await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
  await db.delete(characterStats).where(eq(characterStats.characterId, characterId));
  await db
    .delete(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId)));
  await db.delete(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
}

let exitCode = 0;
try {
  await quiet(() => seedFixture());
  const rows = await runScenarios();
  exitCode = report(rows) ? 0 : 1;
} catch (error) {
  console.error('combat-harness: aborted —', error);
  exitCode = 2;
} finally {
  if (KEEP) console.log(`--keep: fixture left behind (session ${sessionId}).`);
  else await cleanup().catch((error) => console.error('combat-harness: cleanup failed —', error));
}
process.exit(exitCode);
