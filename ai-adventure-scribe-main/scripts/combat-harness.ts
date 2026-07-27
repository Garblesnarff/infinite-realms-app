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
 *   --party <n>   How many player characters are in the encounter (default 1). Monsters are
 *                 scaled to the party actually present, so `--party 1` and `--party 4` print
 *                 different hit points and different damage dice from the same stat blocks.
 *                 Run both and compare; that comparison is the point of the flag.
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
const PARTY_SIZE = Math.max(1, Number(flag('--party') ?? 1));

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

const { and, eq, inArray } = await import('drizzle-orm');
const { db } = await import('../db/client');
const schema = await import('../db/schema/index');
const { combatAttackService } =
  await import('../server-bun/src/services/combat/combat-attack-service');
const { saveTacticalMap, deactivateTacticalMap } =
  await import('../server-bun/src/services/combat/tactical-map-store');
const { CombatEncounterService } =
  await import('../server-bun/src/services/combat/combat-encounter-service');
const { clearCampaignMonsterCache } =
  await import('../server-bun/src/services/combat/campaign-monster-resolution');
const { averageDamage, PARTY_SIZE_BASELINE } =
  await import('../server-bun/src/services/combat/party-scaling');
const { executeCombatIntent } =
  await import('../server-bun/src/services/combat/combat-intent-service');
const { consumeDmTacticalFacts } =
  await import('../server-bun/src/services/combat/tactical-action-service');
const { vitalStateOf } = await import('../server-bun/src/services/combat/death-saves-service');

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
  starterCampaigns,
  campaignChunks,
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
  maxHp: 60,
};

/**
 * One creature per rung of the attack ladder, so a single run shows all of them side by side.
 *
 * `Gluten Golem` is a real campaign-bible creature, and its block here is the shape bibles
 * actually ship: hit points, armour class, speed, and its abilities written as prose. There
 * is no attack line anywhere in it — which is exactly why the derived rung has to exist.
 */
const GLUTEN_GOLEM_CHUNK = [
  '**Gluten Golem**',
  '',
  '**HP:** 90 **AC:** 14 **Speed:** 30ft',
  '',
  '**Abilities:** Rising Dough — the golem swells when heated, filling the corridor behind it.',
].join('\n');

const COMBATANTS = {
  // Catalog rung: a real SRD id, whose printed Slam is +10 for 3d8+6.
  stoneGolem: { name: 'Stone Golem', monsterId: 'srd:stone-golem' },
  // Derived rung: authored HP and AC, no authored attack. Every bible creature today.
  glutenGolem: { name: 'Gluten Golem', monsterId: 'gluten_golem_01' },
  // Generic rung: DM improvisation that matches nothing anywhere.
  doorkeeper: { name: 'The Doorkeeper', monsterId: undefined },
};

const userId = `harness-${randomUUID()}`;
const starterCampaignId = `harness-bible-${randomUUID()}`;
let campaignId = '';
let characterId = '';
/** The rest of the party at `--party N`. Present only so the encounter reads N, not 1. */
const companionCharacterIds: string[] = [];
let sessionId = '';
let encounterId = '';
let heroId = '';
/** Scaled HP as `startCombat` stored it, captured before the scenarios inflate everyone. */
const scaledMaxHpByKey: Record<string, number> = {};
const monsterIds: Record<keyof typeof COMBATANTS, string> = {
  stoneGolem: '',
  glutenGolem: '',
  doorkeeper: '',
};

/**
 * Builds the encounter through `CombatEncounterService.startCombat` rather than by inserting
 * participant rows directly.
 *
 * That is the whole point of the change: attack profiles are resolved and stored *by*
 * startCombat, walking the campaign bible then the SRD catalog then the CR derivation. A
 * harness that inserted its own rows would be asserting against fixture data it wrote itself
 * and would prove nothing about whether the resolution path works.
 */
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

  // A minimal starter campaign carrying one authored creature, so the campaign rung of the
  // ladder is a real database read rather than an injected index.
  await db.insert(starterCampaigns).values({
    id: starterCampaignId,
    slug: starterCampaignId,
    title: 'Combat Harness Bible',
    genre: ['harness'],
    tone: ['diagnostic'],
    difficulty: 'medium',
    premise: 'A fixture campaign that exists only to be fought in.',
  });
  await db.insert(campaignChunks).values({
    campaignId: starterCampaignId,
    chunkType: 'monster',
    entityName: COMBATANTS.glutenGolem.name,
    content: GLUTEN_GOLEM_CHUNK,
  });

  [{ id: sessionId }] = await db
    .insert(gameSessions)
    .values({ campaignId, characterId, sessionNumber: 1, status: 'active', starterCampaignId })
    .returning({ id: gameSessions.id });

  // The rest of the party. They exist only to be counted: party scaling derives its factor
  // from the encounter's player-type participants, so a four-person run needs four of them on
  // the roster. They are never given a turn and never attack.
  for (let index = 1; index < PARTY_SIZE; index += 1) {
    const [row] = await db
      .insert(characters)
      .values({
        userId,
        campaignId,
        name: `Harness Companion ${index}`,
        level: HERO.level,
        class: 'Fighter',
      })
      .returning({ id: characters.id });
    companionCharacterIds.push(row.id);
    await db.insert(characterStats).values({
      characterId: row.id,
      strength: HERO.strength,
      dexterity: HERO.dexterity,
      armorClass: HERO.armorClass,
      maxHitPoints: HERO.maxHp,
      currentHitPoints: HERO.maxHp,
      speed: 30,
    });
  }

  const state = await CombatEncounterService.startCombat(
    sessionId,
    [
      { encounterId: '', characterId, name: HERO.name, initiativeModifier: 1 },
      ...companionCharacterIds.map((id, index) => ({
        encounterId: '',
        characterId: id,
        name: `Harness Companion ${index + 1}`,
        initiativeModifier: 0,
      })),
      ...Object.values(COMBATANTS).map((combatant) => ({
        encounterId: '',
        name: combatant.name,
        initiativeModifier: 0,
        ...(combatant.monsterId ? { monsterId: combatant.monsterId } : {}),
      })),
    ] as Parameters<typeof CombatEncounterService.startCombat>[1],
    false,
    userId,
  );

  encounterId = state.encounter.id;
  const byName = new Map(state.participants.map((p) => [p.name, p.id]));
  heroId = byName.get(HERO.name)!;
  const maxHpByName = new Map(state.participants.map((p) => [p.name, p.maxHp]));
  for (const key of Object.keys(COMBATANTS) as Array<keyof typeof COMBATANTS>) {
    monsterIds[key] = byName.get(COMBATANTS[key].name)!;
    // Captured now, because the next statement gives everyone 400 HP so ten scripted attacks
    // cannot end the fight. The scaled number is what startCombat actually wrote.
    scaledMaxHpByKey[key] = maxHpByName.get(COMBATANTS[key].name)!;
  }

  // startCombat rolls initiative, so the hero can land anywhere in the order; the scenarios
  // hand out turns explicitly. Everyone starts at full HP with a big enough pool that ten
  // attacks cannot end the fight mid-run.
  await db
    .update(combatParticipantStatus)
    .set({ currentHp: 400, maxHp: 400 })
    .where(inArray(combatParticipantStatus.participantId, [heroId, ...Object.values(monsterIds)]));
}

/** The stored attack profile, read back the way the engine reads it. */
async function profileOf(participantId: string): Promise<{
  source: string;
  attack: string;
  derivation?: string;
  multiattack?: string;
  unsupported?: string[];
  scaling?: {
    partySize: number;
    factor: number;
    rawMaxHp: number;
    scaledMaxHp: number;
    rawAttacks: string[];
  };
  scaledAverage?: number;
  /** Just the damage expression, e.g. `1d8+1`, for the raw-versus-scaled table. */
  scaledDamage?: string;
}> {
  const [row] = await db
    .select({ profile: combatParticipants.monsterAttack, name: combatParticipants.name })
    .from(combatParticipants)
    .where(eq(combatParticipants.id, participantId));
  const profile = row?.profile as {
    source?: string;
    attacks?: Array<Record<string, unknown>>;
    derivation?: { fromMaxHp: number; challengeRating: string; damagePerRound: number };
    multiattack?: { desc: string };
    unsupported?: string[];
    partyScaling?: {
      partySize: number;
      factor: number;
      rawMaxHp: number;
      scaledMaxHp: number;
      rawAttacks: string[];
    };
  } | null;
  if (!profile?.attacks?.length) return { source: 'generic', attack: 'Unarmed Strike 1d1 (+0)' };
  const first = profile.attacks[0];
  return {
    source: String(profile.source),
    attack: `${first.name} +${first.attackBonus}, ${first.damageDice}${
      Number(first.damageBonus) ? `+${first.damageBonus}` : ''
    } ${first.damageType}`,
    ...(profile.partyScaling ? { scaling: profile.partyScaling } : {}),
    scaledDamage: `${first.damageDice}${Number(first.damageBonus) ? `+${first.damageBonus}` : ''}`,
    scaledAverage: averageDamage({
      damageDice: String(first.damageDice),
      damageBonus: Number(first.damageBonus ?? 0),
    }),
    ...(profile.derivation
      ? {
          derivation: `${profile.derivation.fromMaxHp} HP -> CR ${profile.derivation.challengeRating} -> ${profile.derivation.damagePerRound} dmg/round`,
        }
      : {}),
    ...(profile.multiattack ? { multiattack: profile.multiattack.desc } : {}),
    ...(profile.unsupported?.length ? { unsupported: profile.unsupported } : {}),
  };
}

/**
 * Places both combatants on a board. `coverBetween` drops a half-cover cell on the line
 * between them, which is the only way to make the engine's cover-adjusted AC observable:
 * without a map there is no geometry, and without geometry cover is never consulted.
 *
 * Adjacent placement (the default) keeps a melee weapon in reach. The cover scenario needs
 * them apart, so it is run with a reach the engine will accept — see `runScenarios`.
 */
async function placeOnBoard(
  monsterParticipantId: string,
  gapCells: number,
  coverBetween: boolean,
): Promise<void> {
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
        id: monsterParticipantId,
        slug: 'harness-monster',
        x: monsterX,
        y: 2,
        size: 'medium',
        type: 'monster',
        speedFeet: 30,
        movementRemaining: 30,
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
  /** Which fixture creature this exchange involves; decides who stands on the board. */
  monster: keyof typeof COMBATANTS;
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
  ...repeat(3, {
    title: 'SRD MONSTER ATTACKS PLAYER (catalog profile)',
    intent:
      "The Stone Golem's own printed Slam: +10 to hit, 3d8+6 bludgeoning, straight out of " +
      'monsters.json. Before this wave the same creature swung at +2 for exactly 1, because ' +
      "nothing ever read the catalog's `actions` array.",
    monster: 'stoneGolem',
    attackerId: () => monsterIds.stoneGolem,
    targetId: () => heroId,
    gapCells: 1,
    cover: false,
  }),
  ...repeat(3, {
    title: 'CAMPAIGN-AUTHORED MONSTER ATTACKS PLAYER (derived profile)',
    intent:
      'The Gluten Golem has authored HP and AC and no attack line anywhere in its bible — the ' +
      'shape every campaign creature ships in. Its attack is inferred from 90 HP via the CR ' +
      'table, and the profile says `derived` so nobody mistakes the inference for a stat block.',
    monster: 'glutenGolem',
    attackerId: () => monsterIds.glutenGolem,
    targetId: () => heroId,
    gapCells: 1,
    cover: false,
  }),
  ...repeat(2, {
    title: 'UNRESOLVED MONSTER ATTACKS PLAYER (generic fallback)',
    intent:
      'DM improvisation that matches no bible and no catalog entry. It still falls back to the ' +
      'unarmed default — correct — and now says so in the telemetry instead of looking like a ' +
      'creature that simply hits softly.',
    monster: 'doorkeeper',
    attackerId: () => monsterIds.doorkeeper,
    targetId: () => heroId,
    gapCells: 1,
    cover: false,
  }),
  ...repeat(3, {
    title: 'PLAYER ATTACKS MONSTER',
    intent:
      'Longsword off the character sheet against the golem AC 17. Player numbers are unchanged ' +
      'by this wave and this is where that is checked.',
    monster: 'stoneGolem',
    attackerId: () => heroId,
    targetId: () => monsterIds.stoneGolem,
    gapCells: 1,
    cover: false,
    weaponId: 'Longsword',
  }),
  ...repeat(2, {
    title: 'PLAYER ATTACKS MONSTER THROUGH HALF COVER',
    intent:
      'Cover-adjusted AC: baseAc 17 against effectiveAc 19 is the +2 half-cover bonus. Ranged, ' +
      'because a melee weapon cannot reach across the covering square.',
    monster: 'stoneGolem',
    attackerId: () => heroId,
    targetId: () => monsterIds.stoneGolem,
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

// ---------------------------------------------------------------------------------------
// Death saves.
//
// Eighteen production runs have never reached this code. Run 18's player never dropped below
// 7 of 11 hit points, so the whole path added in 0abc7383 — going down at 0, rolling a save as
// the order reaches you, three of either kind, a natural 20 — has been shipped and never once
// observed. It cannot be reached by playing more: it depends on the dice going badly, and the
// dice have not.
//
// So the dice are forced here. That is a deliberate exception to this file's own rule against
// pinned rolls, and it is safe for exactly one reason that does not hold for attack
// resolution: `CombatHPService.rollDeathSave` draws its d20 on its FIRST line, before any
// database round-trip. The pinned value therefore cannot be consumed by a connection detail on
// the way to the roll, which is precisely what made forcing wrong for `resolveAttack`. The
// force is spent on the first draw and the seeded stream resumes immediately after, so nothing
// downstream inherits a constant.
// ---------------------------------------------------------------------------------------

/** Pins the very next `Math.random()` to the value that yields `face` on a d20, once. */
async function withForcedD20<T>(face: number, work: () => Promise<T>): Promise<T> {
  let spent = false;
  Math.random = () => {
    if (spent) return prng();
    spent = true;
    // roll = floor(r * 20) + 1, so any r in [(face-1)/20, face/20) produces `face`.
    return (face - 1) / 20 + 0.001;
  };
  try {
    return await work();
  } finally {
    Math.random = prng;
  }
}

type DeathSaveStep = {
  label: string;
  /** What the participant looked like before and after, and what the DM was told. */
  vitalBefore: string;
  vitalAfter: string;
  hp: string;
  tally: string;
  facts: string[];
};

/** The hero's death-save bookkeeping, read straight off the row the engine writes. */
async function vitalsOf(): Promise<{
  vital: string;
  hp: number;
  successes: number;
  failures: number;
}> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const hero = state.participants.find((participant) => participant.id === heroId)!;
  const status = (hero as unknown as { status?: Record<string, number> }).status;
  return {
    vital: vitalStateOf(hero as never),
    hp: status?.currentHp ?? 0,
    successes: status?.deathSavesSuccesses ?? 0,
    failures: status?.deathSavesFailures ?? 0,
  };
}

/** Whoever acts immediately before the hero, so one `end_turn` lands the order on them. */
async function participantBeforeHero(): Promise<string> {
  const rows = await db
    .select({ id: combatParticipants.id, turnOrder: combatParticipants.turnOrder })
    .from(combatParticipants)
    .where(
      and(eq(combatParticipants.encounterId, encounterId), eq(combatParticipants.isActive, true)),
    )
    .orderBy(combatParticipants.turnOrder);
  const heroIndex = rows.findIndex((row) => row.id === heroId);
  return rows[(heroIndex - 1 + rows.length) % rows.length].id;
}

/**
 * Puts the hero back on the floor at 0 HP with a clean tally, and — because a stabilised or
 * dead character ends the encounter, and two of the four scenarios below produce exactly that
 * — puts the encounter back to `active` so the next scenario has a fight to run in.
 *
 * Fixture surgery, stated plainly rather than hidden: the engine ending the encounter each
 * time is the CORRECT behaviour, and re-opening it is how four mutually exclusive endings get
 * demonstrated in one run.
 */
async function resetHeroToDying(): Promise<void> {
  await db
    .update(combatParticipantStatus)
    .set({ currentHp: 0, isConscious: false, deathSavesSuccesses: 0, deathSavesFailures: 0 })
    .where(eq(combatParticipantStatus.participantId, heroId));
  await db
    .update(combatEncounters)
    .set({ status: 'active', endedReason: null, endedAt: null })
    .where(eq(combatEncounters.id, encounterId));
}

/**
 * Advances the order onto the hero with the next death-save d20 pinned, and reports what
 * changed. The turn is passed through `executeCombatIntent`, not through `settleDownedTurns`
 * directly, so what is exercised is the whole production path: the intent gateway, the turn
 * advance, the save, the fact written for the DM, and the fight-over check afterwards.
 */
async function forcedDeathSaveTurn(label: string, face: number): Promise<DeathSaveStep> {
  const before = await vitalsOf();
  const predecessor = await participantBeforeHero();
  await giveTurnTo(predecessor);
  await withForcedD20(face, () =>
    quiet(() =>
      executeCombatIntent(encounterId, { type: 'end_turn', actorId: predecessor }, userId, 'dm'),
    ),
  );
  const after = await vitalsOf();
  return {
    label: `${label} (forced d20 ${face})`,
    vitalBefore: before.vital,
    vitalAfter: after.vital,
    hp: `${before.hp} -> ${after.hp}`,
    tally: `${before.successes}s/${before.failures}f -> ${after.successes}s/${after.failures}f`,
    facts: await consumeDmTacticalFacts(sessionId),
  };
}

/**
 * The four transitions, in the one order that lets a single fixture show all of them: a
 * character is put down by a real attack, saves their way to stabilised, is reset and dies,
 * and is reset once more to come back up on a natural 20.
 */
async function runDeathSaveScenarios(): Promise<DeathSaveStep[]> {
  const steps: DeathSaveStep[] = [];

  // 1. Down by a real blow, not by a fixture write. The Stone Golem's printed Slam against a
  //    hero left on 1 hit point, with the attack roll pinned so the blow certainly lands.
  await placeOnBoard(monsterIds.stoneGolem, 1, false);
  await db
    .update(combatParticipantStatus)
    .set({ currentHp: 1, isConscious: true, deathSavesSuccesses: 0, deathSavesFailures: 0 })
    .where(eq(combatParticipantStatus.participantId, heroId));
  const beforeDown = await vitalsOf();
  await giveTurnTo(monsterIds.stoneGolem);
  // Through the intent gateway rather than `resolveAttack` directly, because the sentence that
  // says what 0 hit points MEANS — unconscious and dying, not dead — is written by the
  // gateway, not by the resolver. Calling the resolver here printed the transition correctly
  // and handed the DM nothing, which is the exact shape of the bug this harness exists to
  // catch, arriving from the harness's own shortcut.
  await withForcedD20(20, () =>
    quiet(() =>
      executeCombatIntent(
        encounterId,
        { type: 'attack', actorId: monsterIds.stoneGolem, targetId: heroId },
        userId,
        'dm',
      ),
    ),
  );
  const afterDown = await vitalsOf();
  steps.push({
    label: 'PLAYER DRIVEN TO 0 HP BY A REAL ATTACK (forced d20 20)',
    vitalBefore: beforeDown.vital,
    vitalAfter: afterDown.vital,
    hp: `${beforeDown.hp} -> ${afterDown.hp}`,
    tally: `${beforeDown.successes}s/${beforeDown.failures}f -> ${afterDown.successes}s/${afterDown.failures}f`,
    facts: await consumeDmTacticalFacts(sessionId),
  });

  // 2. Three successes: stabilised. A 10 or better succeeds without reviving.
  for (let index = 1; index <= 3; index += 1)
    steps.push(await forcedDeathSaveTurn(`DEATH SAVE SUCCESS ${index} of 3`, 15));

  // 3. Three failures: dead. A 9 or worse fails; a 1 would count double and reach three in two
  //    turns, which would prove the tally rather than the threshold.
  await resetHeroToDying();
  for (let index = 1; index <= 3; index += 1)
    steps.push(await forcedDeathSaveTurn(`DEATH SAVE FAILURE ${index} of 3`, 5));

  // 4. A natural 20 is not a success — it is the character back on their feet at 1 HP, taking
  //    the turn they just started. It is the single most important line the DM has never been
  //    handed, and the only one that turns a fight going badly back into a fight.
  await resetHeroToDying();
  steps.push(await forcedDeathSaveTurn('NATURAL 20 REVIVAL', 20));

  return steps;
}

/** Prints the death-save sequence and fails the run if any transition was not the documented one. */
function reportDeathSaves(steps: DeathSaveStep[]): boolean {
  let ok = true;
  console.log('\n' + '-'.repeat(88));
  console.log('DEATH SAVES  (forced dice; unreachable in eighteen production runs)');
  console.log('-'.repeat(88));
  for (const step of steps) {
    console.log(`\n  ${step.label}`);
    console.log(`    state         ${step.vitalBefore} -> ${step.vitalAfter}`);
    console.log(`    hit points    ${step.hp}`);
    console.log(`    save tally    ${step.tally}`);
    if (!step.facts.length) {
      ok = false;
      console.log('    DM WAS TOLD NOTHING — this transition is unnarratable.');
    }
    for (const fact of step.facts) console.log(`    DM fact       ${fact}`);
  }
  // The four states the rules define, each reached exactly once above. A run that reached
  // three of them is a run whose fourth transition silently stopped working.
  const reached = new Set(steps.map((step) => step.vitalAfter));
  for (const expected of ['dying', 'stabilized', 'dead', 'standing']) {
    if (!reached.has(expected)) {
      ok = false;
      console.log(`\n  NEVER REACHED "${expected}" — that death-save transition did not happen.`);
    }
  }
  return ok;
}

async function runScenarios(): Promise<Row[]> {
  const rows: Row[] = [];
  for (const scenario of SCENARIOS) {
    const attacker = scenario.attackerId();
    const target = scenario.targetId();
    await placeOnBoard(monsterIds[scenario.monster], scenario.gapCells, scenario.cover);
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
  'profileSource',
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

function report(
  rows: Row[],
  profiles: Record<string, Awaited<ReturnType<typeof profileOf>>>,
  deathSaves: DeathSaveStep[],
): boolean {
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
    `party             ${PARTY_SIZE} player character(s)  ->  scale factor ${Math.min(
      1,
      PARTY_SIZE / PARTY_SIZE_BASELINE,
    ).toFixed(2)} (baseline ${PARTY_SIZE_BASELINE})`,
  );

  console.log('\n' + '-'.repeat(88));
  console.log('ATTACK PROFILES AS RESOLVED BY startCombat');
  console.log('-'.repeat(88));
  for (const key of Object.keys(COMBATANTS) as Array<keyof typeof COMBATANTS>) {
    const profile = profiles[key];
    console.log(`  ${COMBATANTS[key].name}`);
    console.log(`    source        ${profile.source}`);
    console.log(`    attack        ${profile.attack}`);
    if (profile.derivation) console.log(`    derivation    ${profile.derivation}`);
    if (profile.multiattack)
      console.log(`    multiattack   ${profile.multiattack} [NOT EXPRESSED]`);
    if (profile.unsupported) console.log(`    unsupported   ${profile.unsupported.join('; ')}`);
  }

  // The raw-versus-scaled table. Every number on the left came from a source priced for four
  // adventurers; every number on the right is what this party actually fights.
  console.log('\n' + '-'.repeat(88));
  console.log(
    `PARTY-SIZE SCALING  (party of ${PARTY_SIZE} against a baseline of ${PARTY_SIZE_BASELINE})`,
  );
  console.log('-'.repeat(88));
  console.log(
    '  creature'.padEnd(20) +
      'HP raw -> scaled'.padEnd(20) +
      'damage raw'.padEnd(20) +
      'damage scaled'.padEnd(16) +
      'avg raw -> scaled',
  );
  for (const key of Object.keys(COMBATANTS) as Array<keyof typeof COMBATANTS>) {
    const profile = profiles[key];
    const scaling = profile.scaling;
    const scaledHp = scaledMaxHpByKey[key];
    const rawHp = scaling?.rawMaxHp ?? scaledHp;
    // The generic rung has no scaling record because it is deliberately exempt: its hit
    // points are a placeholder for a combatant nobody wrote, not a party-sized budget.
    const rawExpression = scaling?.rawAttacks[0] ?? '(not scaled)';
    const rawAverage = /avg ([\d.]+)/.exec(rawExpression)?.[1] ?? '—';
    console.log(
      `  ${COMBATANTS[key].name}`.padEnd(20) +
        `${rawHp} -> ${scaledHp}`.padEnd(20) +
        rawExpression.replace(/ \(avg [\d.]+\)/, '').padEnd(20) +
        (scaling ? (profile.scaledDamage ?? '?') : '(not scaled)').padEnd(16) +
        `${rawAverage} -> ${profile.scaledAverage ?? '—'}`,
    );
  }
  if (PARTY_SIZE >= PARTY_SIZE_BASELINE) {
    console.log(
      '  factor is 1.00 at this party size: every block is used exactly as its author wrote it.',
    );
  }
  console.log(
    '  note: the scenarios below then set every combatant to 400 HP so ten scripted attacks\n' +
      '        cannot end the fight. The per-hit cap therefore never binds in this run — the\n' +
      '        damage figures below are what the dice actually said.',
  );
  const sources = new Set(Object.values(profiles).map((profile) => profile.source));
  for (const expected of ['catalog', 'derived', 'generic']) {
    if (!sources.has(expected)) {
      ok = false;
      console.log(
        `  NO ${expected.toUpperCase()} PROFILE RESOLVED — the ladder did not reach that rung.`,
      );
    }
  }

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
      `  ${telemetry.attackerSlug} -> ${telemetry.targetSlug}   weapon ${telemetry.weapon}  [profile: ${telemetry.profileSource}]`,
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

  if (!reportDeathSaves(deathSaves)) ok = false;

  console.log('\n' + '='.repeat(88));
  console.log(ok ? 'PASS — every scenario resolved and logged completely.' : 'FAIL — see above.');
  console.log('='.repeat(88) + '\n');
  return ok;
}

async function cleanup(): Promise<void> {
  await deactivateTacticalMap(sessionId).catch(() => {});
  await db.delete(tacticalMaps).where(eq(tacticalMaps.sessionId, sessionId));
  await db.delete(combatDamageLog).where(eq(combatDamageLog.encounterId, encounterId));
  for (const participantId of [heroId, ...Object.values(monsterIds)]) {
    if (!participantId) continue;
    await db
      .delete(combatParticipantStatus)
      .where(eq(combatParticipantStatus.participantId, participantId));
  }
  await db.delete(combatParticipants).where(eq(combatParticipants.encounterId, encounterId));
  await db.delete(combatEncounters).where(eq(combatEncounters.id, encounterId));
  await db.delete(gameSessions).where(eq(gameSessions.id, sessionId));
  await db.delete(inventoryItems).where(eq(inventoryItems.characterId, characterId));
  for (const id of [characterId, ...companionCharacterIds]) {
    if (!id) continue;
    await db.delete(characterStats).where(eq(characterStats.characterId, id));
    await db.delete(characters).where(and(eq(characters.id, id), eq(characters.userId, userId)));
  }
  await db.delete(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  // Chunks cascade from the starter campaign; the monster-index cache does not, and a stale
  // entry would make a second run in the same process resolve a campaign that no longer exists.
  await db.delete(starterCampaigns).where(eq(starterCampaigns.id, starterCampaignId));
  clearCampaignMonsterCache();
}

let exitCode = 0;
try {
  await quiet(() => seedFixture());
  const rows = await runScenarios();
  const profiles = Object.fromEntries(
    await Promise.all(
      (Object.keys(COMBATANTS) as Array<keyof typeof COMBATANTS>).map(async (key) => [
        key,
        await profileOf(monsterIds[key]),
      ]),
    ),
  ) as Record<string, Awaited<ReturnType<typeof profileOf>>>;
  // Last, because two of its four transitions correctly end the encounter: everything that
  // needs a live fight has already run by the time this starts closing one.
  const deathSaves = await runDeathSaveScenarios();
  exitCode = report(rows, profiles, deathSaves) ? 0 : 1;
} catch (error) {
  console.error('combat-harness: aborted —', error);
  exitCode = 2;
} finally {
  if (KEEP) console.log(`--keep: fixture left behind (session ${sessionId}).`);
  else await cleanup().catch((error) => console.error('combat-harness: cleanup failed —', error));
}
process.exit(exitCode);
