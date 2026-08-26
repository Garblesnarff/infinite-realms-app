#!/usr/bin/env bun
/* eslint-disable max-lines */
/* eslint-disable no-console */
/**
 * Repair starter-seeded characters whose six stored ability scores are still the database
 * defaults even though their source template carries authored scores.
 *
 * Discovery is deliberately relationship-based: a character must be linked to a starter session,
 * match that campaign's source template by name and class, and have stored scores that diverge
 * from the source template. This scans every starter campaign; the historical Academy count is
 * only an operator warning, never a scope filter.
 *
 * The command is manual and dry-run by default. Dry-run prints the complete old -> new row for
 * scores, AC, and level-1 HP. `--apply` requires DATABASE_URL and updates all derived fields for
 * each character inside its own Postgres transaction. A transaction aborts as a unit if the row
 * changed after the reviewed dry run.
 *
 * Usage:
 *   bun scripts/backfill-academy-ability-scores.ts
 *   DATABASE_URL=postgres://... bun scripts/backfill-academy-ability-scores.ts --apply
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import postgres from 'postgres';

import {
  abilityScoreModifier,
  computeArmorClass,
  type ArmorClassEquipmentItem,
} from '../shared/armor-class.ts';
import {
  getAbilityScores,
  type StarterCharacterTemplateLike,
} from '../src/services/character/starter-character-seeding.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

export const EXPECTED_AFFECTED_CHARACTER_COUNT = 3;

const ABILITY_SCORE_NAMES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

type AbilityScoreName = (typeof ABILITY_SCORE_NAMES)[number];
type AbilityScores = Record<AbilityScoreName, number>;
type PostgresClient = ReturnType<typeof postgres>;

/**
 * Keep this local until #1827 gives character hydration a shared class-data home. These are the
 * SRD level-1 hit-die maxima, not the fabricated d8 currently used by the read-time transformer.
 */
export const CLASS_HIT_DICE: Readonly<Record<string, number>> = {
  barbarian: 12,
  bard: 8,
  cleric: 8,
  druid: 8,
  fighter: 10,
  monk: 8,
  paladin: 10,
  ranger: 10,
  rogue: 8,
  sorcerer: 6,
  warlock: 8,
  wizard: 6,
};

export interface StarterSessionRow {
  character_id: string | null;
  starter_campaign_id: string | null;
}

export interface StarterCharacterRow {
  id: string;
  name: string | null;
  class: string | null;
  level: number | null;
}

export interface StarterCharacterStatsRow extends AbilityScores {
  character_id: string;
  armor_class: number | null;
  max_hit_points: number | null;
  current_hit_points: number | null;
}

export type StarterTemplateRow = StarterCharacterTemplateLike & {
  starter_campaign_id: string;
  template_key: string;
};

export interface CharacterEquipmentRow {
  character_id: string;
  item_name: string | null;
  item_type: string | null;
  equipped: boolean | null;
}

export interface CharacterInventoryRow {
  character_id: string;
  name: string | null;
  item_type: string | null;
  is_equipped: boolean | null;
}

export interface StarterBackfillTarget {
  characterId: string;
  starterCampaignId: string;
  templateKey: string;
}

export interface AbilityScoreBackfillPlan {
  characterId: string;
  characterName: string;
  characterClass: string;
  templateKey: string;
  previous: AbilityScores;
  abilityScores: AbilityScores;
  previousArmorClass: number | null;
  armorClass: number;
  previousMaxHitPoints: number | null;
  previousCurrentHitPoints: number | null;
  maxHitPoints: number;
  currentHitPoints: number;
  changed: boolean;
}

export interface AbilityScoreBackfillInput {
  sessions: StarterSessionRow[];
  targets: StarterBackfillTarget[];
  characters: StarterCharacterRow[];
  stats: StarterCharacterStatsRow[];
  templates: StarterTemplateRow[];
  equipment: CharacterEquipmentRow[];
  inventory: CharacterInventoryRow[];
}

export interface AbilityScoreBackfillSummary {
  targets: number;
  changed: number;
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

function scoresFromStats(row: StarterCharacterStatsRow): AbilityScores {
  return Object.fromEntries(ABILITY_SCORE_NAMES.map((name) => [name, row[name]])) as AbilityScores;
}

function scoresFromTemplate(template: StarterTemplateRow): AbilityScores {
  const scores = getAbilityScores(template);
  return Object.fromEntries(
    ABILITY_SCORE_NAMES.map((name) => [name, scores[name]]),
  ) as AbilityScores;
}

function scoresEqual(left: AbilityScores, right: AbilityScores): boolean {
  return ABILITY_SCORE_NAMES.every((name) => left[name] === right[name]);
}

function formatScores(scores: AbilityScores): string {
  return ABILITY_SCORE_NAMES.map((name) => `${name}=${scores[name]}`).join(', ');
}

function classHitDie(className: string): number {
  const hitDie = CLASS_HIT_DICE[className.trim().toLowerCase()];
  if (!hitDie) {
    throw new Error(`Unsupported SRD class "${className}"; refusing level-1 HP repair.`);
  }
  return hitDie;
}

function sameClass(left: string | null, right: string): boolean {
  return (left || '').trim().toLowerCase() === right.trim().toLowerCase();
}

function targetKey(campaignId: string, templateKey: string): string {
  return `${campaignId}:${templateKey}`;
}

/**
 * Find every safe candidate across starter campaigns by the authoritative template relationship.
 * The score divergence check prevents unrelated hand-built rows from entering the repair.
 */
export function findAffectedCharacters(
  sessions: StarterSessionRow[],
  characters: StarterCharacterRow[],
  stats: StarterCharacterStatsRow[],
  templates: StarterTemplateRow[],
): StarterBackfillTarget[] {
  const charactersById = new Map(characters.map((row) => [row.id, row]));
  const statsByCharacterId = new Map(stats.map((row) => [row.character_id, row]));
  const targets = new Map<string, StarterBackfillTarget>();

  for (const session of sessions) {
    if (!session.character_id || !session.starter_campaign_id) continue;

    const character = charactersById.get(session.character_id);
    const characterStats = statsByCharacterId.get(session.character_id);
    if (!character || !characterStats) continue;

    const template = templates.find(
      (candidate) =>
        candidate.starter_campaign_id === session.starter_campaign_id &&
        candidate.name === character.name &&
        sameClass(character.class, candidate.class),
    );
    if (!template || scoresEqual(scoresFromStats(characterStats), scoresFromTemplate(template)))
      continue;

    const target = {
      characterId: session.character_id,
      starterCampaignId: session.starter_campaign_id,
      templateKey: template.template_key,
    };
    const existing = targets.get(session.character_id);
    if (
      existing &&
      (existing.starterCampaignId !== target.starterCampaignId ||
        existing.templateKey !== target.templateKey)
    ) {
      throw new Error(
        `Character ${session.character_id} matches multiple starter templates; refusing ambiguous repair.`,
      );
    }
    targets.set(session.character_id, target);
  }

  return [...targets.values()];
}

/**
 * Build a read-only repair plan. It revalidates the relationship and six-10 predicate so a caller
 * cannot pass an arbitrary target list around the discovery guard.
 */
export function planAbilityScoreBackfill(
  input: AbilityScoreBackfillInput,
): AbilityScoreBackfillPlan[] {
  const sessionByCharacterId = new Map<string, StarterSessionRow>();
  for (const session of input.sessions) {
    if (session.character_id && session.starter_campaign_id) {
      sessionByCharacterId.set(session.character_id, session);
    }
  }
  const charactersById = new Map(input.characters.map((row) => [row.id, row]));
  const statsByCharacterId = new Map(input.stats.map((row) => [row.character_id, row]));
  const templatesByKey = new Map(
    input.templates.map((row) => [targetKey(row.starter_campaign_id, row.template_key), row]),
  );
  const equipmentByCharacterId = new Map<string, ArmorClassEquipmentItem[]>();
  for (const row of input.equipment) {
    const rows = equipmentByCharacterId.get(row.character_id) || [];
    rows.push(row);
    equipmentByCharacterId.set(row.character_id, rows);
  }
  for (const row of input.inventory) {
    const rows = equipmentByCharacterId.get(row.character_id) || [];
    rows.push(row);
    equipmentByCharacterId.set(row.character_id, rows);
  }

  return input.targets.map((target) => {
    const session = sessionByCharacterId.get(target.characterId);
    if (
      !session ||
      session.starter_campaign_id !== target.starterCampaignId ||
      !session.character_id
    ) {
      throw new Error(
        `Target ${target.characterId} is not linked to the declared starter session; refusing repair.`,
      );
    }

    const character = charactersById.get(target.characterId);
    if (!character) throw new Error(`Target character ${target.characterId} was not found.`);
    if (!character.class) throw new Error(`Target character ${target.characterId} has no class.`);
    if ((character.level ?? 1) !== 1) {
      throw new Error(
        `Target ${target.characterId} is level ${character.level}; refusing a level-1 HP repair.`,
      );
    }

    const stats = statsByCharacterId.get(target.characterId);
    if (!stats)
      throw new Error(`Target character ${target.characterId} has no character_stats row.`);

    const template = templatesByKey.get(targetKey(target.starterCampaignId, target.templateKey));
    if (!template) {
      throw new Error(
        `Starter source template ${target.starterCampaignId}/${target.templateKey} was not found.`,
      );
    }
    if (template.name !== character.name || !sameClass(character.class, template.class)) {
      throw new Error(
        `Target ${target.characterId} does not match source template ${target.templateKey}; refusing repair.`,
      );
    }

    const previous = scoresFromStats(stats);
    const abilityScores = scoresFromTemplate(template);
    if (scoresEqual(previous, abilityScores)) {
      throw new Error(
        `Target ${target.characterId} no longer diverges from its source template; refusing repair.`,
      );
    }
    if (stats.max_hit_points === null || stats.current_hit_points === null) {
      throw new Error(`Target ${target.characterId} has incomplete stored hit points.`);
    }

    const equipment = equipmentByCharacterId.get(target.characterId) || [];
    const armorClass = computeArmorClass(equipment, abilityScoreModifier(abilityScores.dexterity));
    const maxHitPoints =
      classHitDie(character.class) + abilityScoreModifier(abilityScores.constitution);
    const currentHitPoints =
      stats.current_hit_points === stats.max_hit_points
        ? maxHitPoints
        : Math.min(stats.current_hit_points, maxHitPoints);
    const changed =
      !scoresEqual(previous, abilityScores) ||
      stats.armor_class !== armorClass ||
      stats.max_hit_points !== maxHitPoints ||
      stats.current_hit_points !== currentHitPoints;

    return {
      characterId: target.characterId,
      characterName: character.name || target.characterId,
      characterClass: character.class,
      templateKey: target.templateKey,
      previous,
      abilityScores,
      previousArmorClass: stats.armor_class,
      armorClass,
      previousMaxHitPoints: stats.max_hit_points,
      previousCurrentHitPoints: stats.current_hit_points,
      maxHitPoints,
      currentHitPoints,
      changed,
    };
  });
}

/** One complete old -> new row for operator review. */
export function formatAbilityScoreBackfillPlan(plan: AbilityScoreBackfillPlan): string {
  return (
    `${plan.characterName} (${plan.characterId}) [${plan.templateKey}]: ` +
    `scores ${formatScores(plan.previous)} -> ${formatScores(plan.abilityScores)}; ` +
    `AC ${plan.previousArmorClass ?? 'null'} -> ${plan.armorClass}; ` +
    `HP ${plan.previousMaxHitPoints}/${plan.previousCurrentHitPoints} -> ` +
    `${plan.maxHitPoints}/${plan.currentHitPoints}`
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

async function selectRows<T>(client: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`Could not read ${table}: ${errorMessage(error)}`);
  return (data ?? []) as unknown as T[];
}

interface CurrentStatsRow extends AbilityScores {
  character_id: string;
  armor_class: number | null;
  max_hit_points: number | null;
  current_hit_points: number | null;
}

function currentStatsMatch(row: CurrentStatsRow, plan: AbilityScoreBackfillPlan): boolean {
  return (
    scoresEqual(scoresFromStats(row), plan.previous) &&
    row.armor_class === plan.previousArmorClass &&
    row.max_hit_points === plan.previousMaxHitPoints &&
    row.current_hit_points === plan.previousCurrentHitPoints
  );
}

/** Apply one plan atomically, with an optimistic old-state check inside the transaction. */
async function applyPlanAtomically(
  sql: PostgresClient,
  plan: AbilityScoreBackfillPlan,
): Promise<void> {
  await sql.begin(async (transaction) => {
    const currentRows = await transaction<CurrentStatsRow[]>`
      SELECT character_id,
             strength,
             dexterity,
             constitution,
             intelligence,
             wisdom,
             charisma,
             armor_class,
             max_hit_points,
             current_hit_points
      FROM character_stats
      WHERE character_id = ${plan.characterId}
      FOR UPDATE
    `;
    const current = currentRows[0];
    if (!current) throw new Error(`No character_stats row found for ${plan.characterId}.`);
    if (!currentStatsMatch(current, plan)) {
      throw new Error(
        `Stored state for ${plan.characterId} changed after dry-run; transaction rolled back.`,
      );
    }

    const updatedRows = await transaction<{ character_id: string }[]>`
      UPDATE character_stats
      SET strength = ${plan.abilityScores.strength},
          dexterity = ${plan.abilityScores.dexterity},
          constitution = ${plan.abilityScores.constitution},
          intelligence = ${plan.abilityScores.intelligence},
          wisdom = ${plan.abilityScores.wisdom},
          charisma = ${plan.abilityScores.charisma},
          armor_class = ${plan.armorClass},
          max_hit_points = ${plan.maxHitPoints},
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
}): Promise<AbilityScoreBackfillSummary> {
  const sessions = await selectRows<StarterSessionRow>(
    options.client,
    'game_sessions',
    'character_id, starter_campaign_id',
  );
  const starterSessions = sessions.filter(
    (row) => row.character_id !== null && row.starter_campaign_id !== null,
  );
  if (starterSessions.length === 0) {
    throw new Error('No starter-session characters found; refusing repair.');
  }

  const campaignIds = [
    ...new Set(
      starterSessions
        .map((row) => row.starter_campaign_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [characters, stats, templates, equipment, inventory] = await Promise.all([
    selectRows<StarterCharacterRow>(options.client, 'characters', 'id, name, class, level'),
    selectRows<StarterCharacterStatsRow>(
      options.client,
      'character_stats',
      `character_id, ${ABILITY_SCORE_NAMES.join(', ')}, armor_class, max_hit_points, current_hit_points`,
    ),
    options.client
      .from('starter_character_templates')
      .select('*')
      .in('starter_campaign_id', campaignIds)
      .then(({ data, error }) => {
        if (error) {
          throw new Error(`Could not read starter_character_templates: ${errorMessage(error)}`);
        }
        return (data ?? []) as StarterTemplateRow[];
      }),
    // These tables are small operator tables. Reading them without a giant UUID `in (...)`
    // filter avoids exceeding the production REST proxy's URL limit after widening discovery.
    selectRows<CharacterEquipmentRow>(
      options.client,
      'character_equipment',
      'character_id, item_name, item_type, equipped',
    ),
    selectRows<CharacterInventoryRow>(
      options.client,
      'inventory_items',
      'character_id, name, item_type, is_equipped',
    ),
  ]);

  const typedStats = stats as StarterCharacterStatsRow[];
  const targets = findAffectedCharacters(starterSessions, characters, typedStats, templates);
  if (targets.length !== EXPECTED_AFFECTED_CHARACTER_COUNT) {
    console.warn(
      `Warning: expected ${EXPECTED_AFFECTED_CHARACTER_COUNT} starter-seeded affected characters, ` +
        `found ${targets.length}; continuing with every discovered target.`,
    );
  }

  const plans = planAbilityScoreBackfill({
    sessions: starterSessions,
    targets,
    characters,
    stats: typedStats,
    templates,
    equipment,
    inventory,
  });
  const changedPlans = plans.filter((plan) => plan.changed);
  const summary: AbilityScoreBackfillSummary = {
    targets: plans.length,
    changed: changedPlans.length,
    skipped: plans.length - changedPlans.length,
    applied: 0,
    failed: 0,
  };

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
    for (const plan of plans) {
      if (!plan.changed) {
        console.log(`Already correct ${formatAbilityScoreBackfillPlan(plan)}`);
        continue;
      }

      console.log(
        `${options.dryRun ? 'Would update' : 'Updating'} ${formatAbilityScoreBackfillPlan(plan)}`,
      );
      if (options.dryRun || !sql) continue;

      try {
        await applyPlanAtomically(sql, plan);
        summary.applied += 1;
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

function printSummary(summary: AbilityScoreBackfillSummary, dryRun: boolean): void {
  console.log('\nStarter ability-score backfill summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Verified targets: ${summary.targets}`);
  console.log(`  Needing repair: ${summary.changed}`);
  console.log(`  Already correct: ${summary.skipped}`);
  console.log(`  Updated: ${summary.applied}`);
  console.log(`  Failed: ${summary.failed}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: { dryRun: boolean };
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(errorMessage(error));
    console.error('Usage: bun scripts/backfill-academy-ability-scores.ts [--apply]');
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
    console.error(`Starter ability-score backfill failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
