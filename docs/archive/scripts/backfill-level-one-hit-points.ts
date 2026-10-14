#!/usr/bin/env bun
/* eslint-disable max-lines */
/* eslint-disable no-console */
/**
 * Repair stored level-1 character HP that was initialized with a fixed hit die instead of the
 * character's class hit die.
 *
 * OPERATOR GUARD: run this script only AFTER #1881's ability-score backfill has applied. Running
 * it earlier would recompute from the known all-10 Constitution rows and write incorrect HP.
 *
 * The command is manual and dry-run by default. Dry-run prints an old -> new table for every
 * resolved character and reports rows whose class or level cannot be safely resolved. `--apply`
 * requires DATABASE_URL and updates only rows whose stored state still matches the reviewed plan.
 * The current-HP rule is the issue's exact rule: `newCurrent = (oldCurrent === oldMax) ? newMax :
 * min(oldCurrent, newMax)` — full characters stay full and wounds persist, capped at new max HP.
 *
 * Usage:
 *   bun scripts/backfill-level-one-hit-points.ts
 *   DATABASE_URL=postgres://... bun scripts/backfill-level-one-hit-points.ts --apply
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import postgres from 'postgres';

import { abilityScoreModifier } from '../shared/armor-class.ts';
import { findSrdClass, type SrdHitDie } from '../shared/srd-class-data.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

type PostgresClient = ReturnType<typeof postgres>;

export interface CharacterRow {
  id: string;
  name: string | null;
  class: string | null;
  level: number | null;
}

export interface CharacterStatsRow {
  character_id: string;
  constitution: number | null;
  max_hit_points: number | null;
  current_hit_points: number | null;
}

export interface LevelOneHitPointBackfillPlan {
  characterId: string;
  characterName: string;
  characterClass: string;
  level: number;
  constitution: number;
  constitutionModifier: number;
  hitDie: SrdHitDie;
  previousMaxHitPoints: number;
  previousCurrentHitPoints: number;
  maxHitPoints: number;
  currentHitPoints: number;
  changed: boolean;
}

export interface SkippedHitPointBackfillRow {
  characterId: string;
  characterName: string;
  characterClass: string | null;
  reason: string;
}

export interface LevelOneHitPointBackfillInput {
  characters: CharacterRow[];
  stats: CharacterStatsRow[];
}

export interface LevelOneHitPointBackfillResult {
  plans: LevelOneHitPointBackfillPlan[];
  skipped: SkippedHitPointBackfillRow[];
}

export interface LevelOneHitPointBackfillSummary {
  scanned: number;
  resolved: number;
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

function formatCell(value: string | number): string {
  return String(value).replaceAll('|', '\\|');
}

/** Build the deterministic level-1 repair plan without performing any writes. */
export function planLevelOneHitPointBackfill(
  input: LevelOneHitPointBackfillInput,
): LevelOneHitPointBackfillResult {
  const statsByCharacterId = new Map(input.stats.map((row) => [row.character_id, row]));
  const plans: LevelOneHitPointBackfillPlan[] = [];
  const skipped: SkippedHitPointBackfillRow[] = [];

  for (const character of input.characters) {
    const characterName = displayName(character);
    const stats = statsByCharacterId.get(character.id);
    if (!stats) {
      skipped.push({
        characterId: character.id,
        characterName,
        characterClass: character.class,
        reason: 'character_stats row is missing',
      });
      continue;
    }

    if (character.level !== 1) {
      skipped.push({
        characterId: character.id,
        characterName,
        characterClass: character.class,
        reason: `level is ${character.level ?? 'null'}, expected level 1`,
      });
      continue;
    }

    const classData = findSrdClass(character.class);
    if (!classData) {
      skipped.push({
        characterId: character.id,
        characterName,
        characterClass: character.class,
        reason: 'class cannot be resolved from shared/srd-class-data.ts; refusing to guess',
      });
      continue;
    }

    if (
      stats.constitution === null ||
      stats.max_hit_points === null ||
      stats.current_hit_points === null
    ) {
      skipped.push({
        characterId: character.id,
        characterName,
        characterClass: character.class,
        reason: 'constitution or stored HP is null; refusing incomplete repair',
      });
      continue;
    }

    const constitutionModifier = abilityScoreModifier(stats.constitution);
    const maxHitPoints = classData.hitDie + constitutionModifier;
    const currentHitPoints =
      stats.max_hit_points === maxHitPoints
        ? stats.current_hit_points
        : stats.current_hit_points === stats.max_hit_points
          ? maxHitPoints
          : Math.min(stats.current_hit_points, maxHitPoints);

    plans.push({
      characterId: character.id,
      characterName,
      characterClass: character.class || classData.name,
      level: character.level,
      constitution: stats.constitution,
      constitutionModifier,
      hitDie: classData.hitDie,
      previousMaxHitPoints: stats.max_hit_points,
      previousCurrentHitPoints: stats.current_hit_points,
      maxHitPoints,
      currentHitPoints,
      changed: stats.max_hit_points !== maxHitPoints,
    });
  }

  return { plans, skipped };
}

/** Format the operator-review table printed by every dry run. */
export function formatHitPointBackfillTable(plan: LevelOneHitPointBackfillResult): string {
  const header =
    '| character | class | CON | hit die | HP old (max/current) | HP new (max/current) | action |';
  const separator = '|---|---|---:|---:|---:|---:|---|';
  const rows = plan.plans.map(
    (row) =>
      `| ${formatCell(`${row.characterName} (${row.characterId})`)} | ${formatCell(row.characterClass)} | ` +
      `${row.constitution} (${row.constitutionModifier >= 0 ? '+' : ''}${row.constitutionModifier}) | ` +
      `d${row.hitDie} | ${row.previousMaxHitPoints}/${row.previousCurrentHitPoints} | ` +
      `${row.maxHitPoints}/${row.currentHitPoints} | ${row.changed ? 'would update' : 'already correct'} |`,
  );
  return [header, separator, ...rows].join('\n');
}

function formatSkippedRow(row: SkippedHitPointBackfillRow): string {
  return `Skipped ${row.characterName} (${row.characterId}) [${row.characterClass || 'null'}]: ${row.reason}`;
}

export function parseCliArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = true;
  for (const argument of argv) {
    if (argument === '--apply') dryRun = false;
    else if (argument === '--dry-run') dryRun = true;
    else throw new Error(`Unknown option: ${argument}`);
  }
  return { dryRun };
}

async function selectRows<T>(client: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`Could not read ${table}: ${errorMessage(error)}`);
  return (data ?? []) as unknown as T[];
}

interface CurrentStatsRow {
  character_id: string;
  constitution: number | null;
  max_hit_points: number | null;
  current_hit_points: number | null;
}

function currentStatsMatch(row: CurrentStatsRow, plan: LevelOneHitPointBackfillPlan): boolean {
  return (
    row.constitution === plan.constitution &&
    row.max_hit_points === plan.previousMaxHitPoints &&
    row.current_hit_points === plan.previousCurrentHitPoints
  );
}

/** Apply one plan atomically, with an optimistic old-state check inside the transaction. */
async function applyPlanAtomically(
  sql: PostgresClient,
  plan: LevelOneHitPointBackfillPlan,
): Promise<void> {
  await sql.begin(async (transaction) => {
    const currentRows = await transaction<CurrentStatsRow[]>`
      SELECT character_id, constitution, max_hit_points, current_hit_points
      FROM character_stats
      WHERE character_id = ${plan.characterId}
      FOR UPDATE
    `;
    const current = currentRows[0];
    if (!current) throw new Error(`No character_stats row found for ${plan.characterId}.`);
    if (!currentStatsMatch(current, plan)) {
      throw new Error(
        `Stored HP for ${plan.characterId} changed after dry-run; transaction rolled back.`,
      );
    }

    const updatedRows = await transaction<{ character_id: string }[]>`
      UPDATE character_stats
      SET max_hit_points = ${plan.maxHitPoints},
          current_hit_points = ${plan.currentHitPoints}
      WHERE character_id = ${plan.characterId}
      RETURNING character_id
    `;
    if (updatedRows.length !== 1) {
      throw new Error(`Expected one updated character_stats row for ${plan.characterId}.`);
    }
  });
}

export async function runBackfill(options: {
  dryRun: boolean;
  client: SupabaseClient;
}): Promise<LevelOneHitPointBackfillSummary> {
  const [characters, stats] = await Promise.all([
    selectRows<CharacterRow>(options.client, 'characters', 'id, name, class, level'),
    selectRows<CharacterStatsRow>(
      options.client,
      'character_stats',
      'character_id, constitution, max_hit_points, current_hit_points',
    ),
  ]);
  if (characters.length === 0) throw new Error('No characters found; refusing HP repair.');

  const plan = planLevelOneHitPointBackfill({ characters, stats });
  const changedPlans = plan.plans.filter((row) => row.changed);
  const summary: LevelOneHitPointBackfillSummary = {
    scanned: characters.length,
    resolved: plan.plans.length,
    needingRepair: changedPlans.length,
    alreadyCorrect: plan.plans.length - changedPlans.length,
    skipped: plan.skipped.length,
    applied: 0,
    failed: 0,
  };

  console.log('\nLevel-1 stored HP backfill old -> new table');
  console.log(formatHitPointBackfillTable(plan));
  for (const skipped of plan.skipped) console.log(formatSkippedRow(skipped));

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
    for (const row of changedPlans) {
      if (options.dryRun || !sql) continue;
      try {
        await applyPlanAtomically(sql, row);
        summary.applied += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`Failed ${row.characterId}: ${errorMessage(error)}`);
      }
    }
  } finally {
    await sql?.end();
  }

  return summary;
}

function printSummary(summary: LevelOneHitPointBackfillSummary, dryRun: boolean): void {
  console.log('\nLevel-1 stored HP backfill summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Scanned characters: ${summary.scanned}`);
  console.log(`  Resolved level-1 rows: ${summary.resolved}`);
  console.log(`  Needing repair: ${summary.needingRepair}`);
  console.log(`  Already correct: ${summary.alreadyCorrect}`);
  console.log(`  Skipped: ${summary.skipped}`);
  console.log(`  Updated: ${summary.applied}`);
  console.log(`  Failed: ${summary.failed}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: { dryRun: boolean };
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(errorMessage(error));
    console.error('Usage: bun scripts/backfill-level-one-hit-points.ts [--dry-run|--apply]');
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
    console.error(`Level-1 stored HP backfill failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
