#!/usr/bin/env bun
/* eslint-disable max-lines */
/* eslint-disable no-console */
/**
 * Seed `character_stats` for the two production characters that were created without a
 * stats row (#1939 Defect B).
 *
 * Targets (full UUIDs; prefixes 16127a23 / 506c28d7):
 *   - The Seeker  `16127a23-2052-46b7-ab19-772402e9bb69`  (Catfolk Monk)
 *   - The Reveler `506c28d7-5ac0-422e-b470-1c09f70878b1`  (Elf Barbarian)
 *
 * ## Mid-January creation path (why these two rows exist)
 *
 * Both characters were created in mid-January 2026 (`created_at` equals `updated_at`, so
 * they were never edited). Their names are Eternal Feast starter-template names.
 *
 * On 2026-01-15 the live clone path was
 * `src/components/campaign-list/character-selection-modal.tsx` → `handleSelectTemplate`:
 * it inserted the `characters` row first, then inserted `character_stats` in a *separate*
 * call, and on stats failure logged the error and continued — "Don't throw - character was
 * created, stats are optional." That is not a transaction. A stats insert that failed
 * (RLS, missing column, network) left a playable character with no stats row.
 *
 * Dates line up with that modal, not with the later `seedStarterCharacter` helper (added
 * 2026-07-10). The Reveler's stored race/class (Elf Barbarian) matches the Eternal Feast
 * template as of 2026-01-15. The Seeker's stored class is Monk; git's template that day
 * was Catfolk Rogue. The repair uses the stored race/class, not today's templates (which
 * have since drifted: Seeker → Ranger, Reveler → Satyr).
 *
 * Scores are not recoverable from any legacy table. This script seeds the 2014 standard
 * array onto class priority, then applies racial ability-score increases, class hit-die
 * HP, and unarmored-defense AC. Companion join guards are out of scope (post-Sep 3).
 *
 * Dry-run is the default. `--apply` requires DATABASE_URL, uses one transaction per
 * character, skips an existing stats row, and stamps `updated_at` only when it inserts.
 *
 * Usage:
 *   bun scripts/backfill-statless-character-stats.ts
 *   DATABASE_URL=postgres://... bun scripts/backfill-statless-character-stats.ts --apply
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import postgres from 'postgres';

import { abilityScoreModifier } from '../shared/armor-class.ts';
import { findSrdClass, SRD_ABILITY_NAMES, type SrdAbilityName } from '../shared/srd-class-data.ts';
import { races } from '../src/data/races/index.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

type PostgresClient = ReturnType<typeof postgres>;
type AbilityScores = Record<SrdAbilityName, number>;

export const STATLESS_CHARACTER_IDS = [
  '16127a23-2052-46b7-ab19-772402e9bb69',
  '506c28d7-5ac0-422e-b470-1c09f70878b1',
] as const;

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const;

/**
 * Typical 2014 array order: class primary, then the ability the class actually needs
 * next (WIS for monks, CON for barbarians), then the rest. Saving-throw order is the
 * wrong proxy — a Monk's saves are STR/DEX, but the array wants DEX/WIS.
 */
export const CLASS_ABILITY_PRIORITY: Readonly<Record<string, readonly SrdAbilityName[]>> = {
  barbarian: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
  bard: ['charisma', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'strength'],
  cleric: ['wisdom', 'constitution', 'strength', 'charisma', 'intelligence', 'dexterity'],
  druid: ['wisdom', 'constitution', 'dexterity', 'intelligence', 'charisma', 'strength'],
  fighter: ['strength', 'constitution', 'dexterity', 'wisdom', 'charisma', 'intelligence'],
  monk: ['dexterity', 'wisdom', 'constitution', 'strength', 'intelligence', 'charisma'],
  paladin: ['strength', 'charisma', 'constitution', 'wisdom', 'dexterity', 'intelligence'],
  ranger: ['dexterity', 'wisdom', 'constitution', 'strength', 'charisma', 'intelligence'],
  rogue: ['dexterity', 'intelligence', 'constitution', 'wisdom', 'charisma', 'strength'],
  sorcerer: ['charisma', 'constitution', 'dexterity', 'intelligence', 'wisdom', 'strength'],
  warlock: ['charisma', 'constitution', 'dexterity', 'wisdom', 'intelligence', 'strength'],
  wizard: ['intelligence', 'constitution', 'dexterity', 'wisdom', 'charisma', 'strength'],
};

export interface CharacterRow {
  id: string;
  name: string | null;
  race: string | null;
  subrace: string | null;
  class: string | null;
  level: number | null;
}

export interface CharacterStatsRow {
  character_id: string;
}

export interface StatlessRepairPlan {
  characterId: string;
  characterName: string;
  race: string;
  characterClass: string;
  level: number;
  abilityScores: AbilityScores;
  armorClass: number;
  maxHitPoints: number;
  currentHitPoints: number;
  speed: number;
  changed: boolean;
}

export interface SkippedStatlessRow {
  characterId: string;
  characterName: string;
  reason: string;
}

export interface StatlessRepairInput {
  characters: CharacterRow[];
  stats: CharacterStatsRow[];
}

export interface StatlessRepairResult {
  plans: StatlessRepairPlan[];
  skipped: SkippedStatlessRow[];
}

export interface StatlessRepairSummary {
  targets: number;
  needingRepair: number;
  alreadyCorrect: number;
  skipped: number;
  applied: number;
  failed: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

function displayName(character: CharacterRow): string {
  return character.name?.trim() || character.id;
}

function normalizeIdentity(value: string | null | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function findRace(raceName: string | null | undefined) {
  const key = normalizeIdentity(raceName);
  if (!key) return undefined;
  return races.find(
    (race) => normalizeIdentity(race.id) === key || normalizeIdentity(race.name) === key,
  );
}

function findSubrace(
  race: NonNullable<ReturnType<typeof findRace>>,
  subraceName: string | null | undefined,
) {
  const key = normalizeIdentity(subraceName);
  if (!key) return undefined;
  return race.subraces?.find(
    (subrace) => normalizeIdentity(subrace.id) === key || normalizeIdentity(subrace.name) === key,
  );
}

export function assignClassStandardArray(classId: string): AbilityScores {
  const priority = CLASS_ABILITY_PRIORITY[classId];
  if (!priority || priority.length !== SRD_ABILITY_NAMES.length) {
    throw new Error(`No standard-array priority for class "${classId}".`);
  }
  const scores = {
    strength: 8,
    dexterity: 8,
    constitution: 8,
    intelligence: 8,
    wisdom: 8,
    charisma: 8,
  } satisfies AbilityScores;
  for (let index = 0; index < priority.length; index += 1) {
    scores[priority[index]] = STANDARD_ARRAY[index];
  }
  return scores;
}

export function applyRacialAbilityIncreases(
  scores: AbilityScores,
  raceName: string,
  subraceName?: string | null,
): { scores: AbilityScores; speed: number } {
  const race = findRace(raceName);
  if (!race) {
    throw new Error(`Unknown race "${raceName}"; refusing to guess ability increases.`);
  }
  const next = { ...scores };
  const apply = (bonus: Partial<Record<SrdAbilityName, number>> | undefined) => {
    if (!bonus) return;
    for (const ability of SRD_ABILITY_NAMES) {
      const amount = bonus[ability];
      if (typeof amount === 'number') next[ability] += amount;
    }
  };
  apply(race.abilityScoreIncrease);
  const subrace = findSubrace(race, subraceName);
  apply(subrace?.abilityScoreIncrease);
  return { scores: next, speed: subrace?.speed ?? race.speed };
}

export function unarmoredArmorClass(classId: string, scores: AbilityScores): number {
  const dex = abilityScoreModifier(scores.dexterity);
  if (classId === 'monk') return 10 + dex + abilityScoreModifier(scores.wisdom);
  if (classId === 'barbarian') return 10 + dex + abilityScoreModifier(scores.constitution);
  return 10 + dex;
}

export function seedRaceClassDefaults(character: CharacterRow): StatlessRepairPlan {
  const srdClass = findSrdClass(character.class);
  if (!srdClass) {
    throw new Error(
      `Class "${character.class ?? ''}" cannot be resolved; refusing to invent a hit die.`,
    );
  }
  const level = character.level ?? 1;
  if (level !== 1) {
    throw new Error(`Refusing to seed level ${level}; this repair is level-1 only.`);
  }
  if (!character.race?.trim()) {
    throw new Error('Character has no race; refusing to guess racial bonuses.');
  }
  const base = assignClassStandardArray(srdClass.id);
  const { scores, speed } = applyRacialAbilityIncreases(base, character.race, character.subrace);
  const constitutionModifier = abilityScoreModifier(scores.constitution);
  const maxHitPoints = srdClass.hitDie + constitutionModifier;
  return {
    characterId: character.id,
    characterName: displayName(character),
    race: character.race,
    characterClass: srdClass.name,
    level,
    abilityScores: scores,
    armorClass: unarmoredArmorClass(srdClass.id, scores),
    maxHitPoints,
    currentHitPoints: maxHitPoints,
    speed,
    changed: true,
  };
}

export function planStatlessCharacterRepair(input: StatlessRepairInput): StatlessRepairResult {
  const charactersById = new Map(input.characters.map((row) => [row.id, row]));
  const statsByCharacter = new Set(input.stats.map((row) => row.character_id));
  const plans: StatlessRepairPlan[] = [];
  const skipped: SkippedStatlessRow[] = [];

  for (const characterId of STATLESS_CHARACTER_IDS) {
    const character = charactersById.get(characterId);
    if (!character) {
      skipped.push({
        characterId,
        characterName: characterId,
        reason: 'character row was not found',
      });
      continue;
    }
    if (statsByCharacter.has(characterId)) {
      skipped.push({
        characterId,
        characterName: displayName(character),
        reason: 'character_stats row already exists; leaving it untouched',
      });
      continue;
    }
    try {
      plans.push(seedRaceClassDefaults(character));
    } catch (error) {
      skipped.push({
        characterId,
        characterName: displayName(character),
        reason: errorMessage(error),
      });
    }
  }

  return { plans, skipped };
}

export function formatStatlessRepairPlan(plan: StatlessRepairPlan): string {
  const scores = SRD_ABILITY_NAMES.map(
    (ability) => `${ability.slice(0, 3).toUpperCase()} ${plan.abilityScores[ability]}`,
  ).join(' ');
  return (
    `${plan.characterName} (${plan.characterId}) ${plan.race} ${plan.characterClass}: ` +
    `${scores}; AC ${plan.armorClass}; HP ${plan.maxHitPoints}/${plan.currentHitPoints}; ` +
    `speed ${plan.speed}`
  );
}

export function parseCliArgs(argv: string[]): { dryRun: boolean } {
  let apply = false;
  for (const argument of argv) {
    if (argument === '--apply' || argument === '--no-dry-run') apply = true;
    else if (argument === '--dry-run') apply = false;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return { dryRun: !apply };
}

async function selectTargetCharacters(client: SupabaseClient): Promise<CharacterRow[]> {
  const { data, error } = await client
    .from('characters')
    .select('id, name, race, subrace, class, level')
    .in('id', [...STATLESS_CHARACTER_IDS]);
  if (error) throw new Error(`Could not read characters: ${errorMessage(error)}`);
  return (data ?? []) as CharacterRow[];
}

async function selectTargetStats(client: SupabaseClient): Promise<CharacterStatsRow[]> {
  const { data, error } = await client
    .from('character_stats')
    .select('character_id')
    .in('character_id', [...STATLESS_CHARACTER_IDS]);
  if (error) throw new Error(`Could not read character_stats: ${errorMessage(error)}`);
  return (data ?? []) as CharacterStatsRow[];
}

function currentCharacterMatches(
  row: { id: string; name: string | null; race: string | null; class: string | null },
  plan: StatlessRepairPlan,
): boolean {
  return (
    row.id === plan.characterId &&
    (row.name?.trim() || row.id) === plan.characterName &&
    (row.race || '') === plan.race &&
    normalizeIdentity(row.class) === normalizeIdentity(plan.characterClass)
  );
}

/** Insert one stats row atomically. Existing rows are a no-op so reruns stay idempotent. */
async function applyPlanAtomically(
  sql: PostgresClient,
  plan: StatlessRepairPlan,
): Promise<boolean> {
  return sql.begin(async (transaction) => {
    const currentRows = await transaction<
      { id: string; name: string | null; race: string | null; class: string | null }[]
    >`
      SELECT id, name, race, class
      FROM characters
      WHERE id = ${plan.characterId}
      FOR UPDATE
    `;
    const current = currentRows[0];
    if (!current) throw new Error(`Character ${plan.characterId} was not found.`);
    if (!currentCharacterMatches(current, plan)) {
      throw new Error(
        `Stored identity for ${plan.characterId} changed after dry-run; transaction rolled back.`,
      );
    }

    const existing = await transaction<{ character_id: string }[]>`
      SELECT character_id
      FROM character_stats
      WHERE character_id = ${plan.characterId}
      FOR UPDATE
    `;
    if (existing.length > 0) return false;

    const inserted = await transaction<{ character_id: string }[]>`
      INSERT INTO character_stats (
        character_id,
        strength,
        dexterity,
        constitution,
        intelligence,
        wisdom,
        charisma,
        armor_class,
        max_hit_points,
        current_hit_points,
        speed,
        is_conscious,
        vital_state,
        updated_at
      )
      VALUES (
        ${plan.characterId},
        ${plan.abilityScores.strength},
        ${plan.abilityScores.dexterity},
        ${plan.abilityScores.constitution},
        ${plan.abilityScores.intelligence},
        ${plan.abilityScores.wisdom},
        ${plan.abilityScores.charisma},
        ${plan.armorClass},
        ${plan.maxHitPoints},
        ${plan.currentHitPoints},
        ${plan.speed},
        true,
        'standing',
        NOW()
      )
      RETURNING character_id
    `;
    if (inserted.length !== 1) {
      throw new Error(`Expected one inserted character_stats row for ${plan.characterId}.`);
    }

    const stamped = await transaction<{ id: string }[]>`
      UPDATE characters
      SET updated_at = NOW()
      WHERE id = ${plan.characterId}
      RETURNING id
    `;
    if (stamped.length !== 1) {
      throw new Error(`Expected to stamp characters.updated_at for ${plan.characterId}.`);
    }
    return true;
  });
}

export async function runBackfill(options: {
  dryRun: boolean;
  client: SupabaseClient;
}): Promise<StatlessRepairSummary> {
  const result = planStatlessCharacterRepair({
    characters: await selectTargetCharacters(options.client),
    stats: await selectTargetStats(options.client),
  });

  const summary: StatlessRepairSummary = {
    targets: STATLESS_CHARACTER_IDS.length,
    needingRepair: result.plans.length,
    alreadyCorrect: result.skipped.filter((row) => row.reason.includes('already exists')).length,
    skipped: result.skipped.length,
    applied: 0,
    failed: 0,
  };

  for (const skipped of result.skipped) {
    console.log(`Skipping ${skipped.characterName} (${skipped.characterId}): ${skipped.reason}`);
  }

  const sql = options.dryRun
    ? null
    : (() => {
        const databaseUrl = process.env.DATABASE_URL;
        if (!databaseUrl) {
          throw new Error('DATABASE_URL is required for --apply transactional writes.');
        }
        return postgres(databaseUrl, { max: 1, onnotice: () => {} });
      })();

  try {
    for (const plan of result.plans) {
      console.log(
        `${options.dryRun ? 'Would insert' : 'Inserting'} ${formatStatlessRepairPlan(plan)}`,
      );
      if (options.dryRun || !sql) continue;
      try {
        const inserted = await applyPlanAtomically(sql, plan);
        if (inserted) summary.applied += 1;
        else {
          summary.alreadyCorrect += 1;
          console.log(`Already present ${plan.characterName} (${plan.characterId})`);
        }
      } catch (error) {
        summary.failed += 1;
        console.error(`Failed ${plan.characterId}: ${errorMessage(error)}`);
      }
    }
  } finally {
    await sql?.end();
  }

  return summary;
}

function printSummary(summary: StatlessRepairSummary, dryRun: boolean): void {
  console.log('\nStatless character_stats repair summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Named targets: ${summary.targets}`);
  console.log(`  Needing repair: ${summary.needingRepair}`);
  console.log(`  Already present: ${summary.alreadyCorrect}`);
  console.log(`  Skipped: ${summary.skipped}`);
  console.log(`  Inserted: ${summary.applied}`);
  console.log(`  Failed: ${summary.failed}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: { dryRun: boolean };
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(errorMessage(error));
    console.error('Usage: bun scripts/backfill-statless-character-stats.ts [--dry-run|--apply]');
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase connection settings.');
    process.exitCode = 1;
    return;
  }

  try {
    const summary = await runBackfill({
      dryRun: options.dryRun,
      client: createClient(supabaseUrl, serviceRoleKey),
    });
    printSummary(summary, options.dryRun);
    if (summary.failed > 0) process.exitCode = 1;
  } catch (error) {
    console.error(`Statless character_stats repair failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
