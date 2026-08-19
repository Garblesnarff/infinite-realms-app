#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Recompute every character's stored armour class from the equipment they are wearing.
 *
 * `buildStarterCharacterSeed` wrote `10 + DEX` two lines after building the equipment it
 * ignored, and nothing ever recomputed it, so 76 of 112 live characters wear equipped armour
 * that does nothing (#1858). The seeder and the server-side equipment write path now both go
 * through `computeArmorClass`; this script is the one-time repair for the rows written before
 * they did, and it calls the same function, so a repaired row and a freshly seeded one cannot
 * disagree.
 *
 * Idempotent: a character whose stored AC already equals the computed one is counted and never
 * written. Characters with no armour and no shield anywhere in their kit are skipped entirely
 * — their AC may have been set by hand (a DM-authored NPC, a monk, a barbarian's Unarmored
 * Defense), and `10 + DEX` is not an improvement on that.
 *
 * Like `backfill-starter-characters.ts` this is intentionally manual: it never runs as part of
 * migrations or application startup, and it is a dry run unless --apply is supplied.
 *
 * Usage:
 *   bun scripts/backfill-armor-class.ts
 *   bun scripts/backfill-armor-class.ts --apply
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import {
  abilityScoreModifier,
  describeArmorClass,
  type ArmorClassEquipmentItem,
} from '../shared/armor-class.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

const USAGE = 'Usage: bun scripts/backfill-armor-class.ts [--apply]';

/** `inventory_items` has no shield type; the legacy table does, so both are accepted. */
const ARMOR_ITEM_TYPES = new Set(['armor', 'shield']);

export interface CharacterRow {
  id: string;
  name: string | null;
}

export interface CharacterStatsRow {
  character_id: string;
  dexterity: number | null;
  armor_class: number | null;
}

export interface EquipmentRow {
  character_id: string;
  item_name: string | null;
  item_type: string | null;
  equipped: boolean | null;
}

export interface InventoryRow {
  character_id: string;
  name: string | null;
  item_type: string | null;
  is_equipped: boolean | null;
}

export interface ArmorClassPlan {
  characterId: string;
  characterName: string;
  dexterityModifier: number;
  previousArmorClass: number | null;
  armorClass: number;
  armorName: string | null;
  hasShield: boolean;
  unrecognizedArmorNames: string[];
  changed: boolean;
}

export interface BackfillSummary {
  characters: number;
  equipmentDriven: number;
  changed: number;
  applied: number;
  failed: number;
}

export interface BackfillInput {
  characters: CharacterRow[];
  stats: CharacterStatsRow[];
  equipment: EquipmentRow[];
  inventory: InventoryRow[];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

/**
 * Decide what every character's armour class should be, without touching the database.
 *
 * Pure so the repair can be read and tested before it is run against production: the Hetzner
 * session runs the dry run, reads the old -> new lines, and only then supplies --apply.
 */
export function planArmorClassBackfill(input: BackfillInput): ArmorClassPlan[] {
  const nameById = new Map(input.characters.map((row) => [row.id, row.name?.trim() || null]));
  const itemsByCharacter = new Map<string, ArmorClassEquipmentItem[]>();

  const addItem = (characterId: string, item: ArmorClassEquipmentItem): void => {
    const items = itemsByCharacter.get(characterId);
    if (items) items.push(item);
    else itemsByCharacter.set(characterId, [item]);
  };

  for (const row of input.equipment) {
    addItem(row.character_id, {
      item_name: row.item_name,
      item_type: row.item_type,
      equipped: row.equipped,
    });
  }
  for (const row of input.inventory) {
    addItem(row.character_id, {
      name: row.name,
      item_type: row.item_type,
      is_equipped: row.is_equipped,
    });
  }

  const plans: ArmorClassPlan[] = [];
  for (const stats of input.stats) {
    const items = itemsByCharacter.get(stats.character_id) ?? [];
    const ownsArmor = items.some((item) =>
      ARMOR_ITEM_TYPES.has((item.item_type ?? '').trim().toLowerCase()),
    );
    if (!ownsArmor) continue;

    const characterName = nameById.get(stats.character_id) ?? 'Unnamed character';
    const dexterityModifier = abilityScoreModifier(stats.dexterity ?? 10);
    const breakdown = describeArmorClass(items, dexterityModifier, {
      warn: (message, context) =>
        console.warn(
          `${characterName} (${stats.character_id}): ${message} ${JSON.stringify(context)}`,
        ),
    });

    plans.push({
      characterId: stats.character_id,
      characterName,
      dexterityModifier,
      previousArmorClass: stats.armor_class,
      armorClass: breakdown.armorClass,
      armorName: breakdown.armor?.name ?? null,
      hasShield: breakdown.shieldBonus > 0,
      unrecognizedArmorNames: breakdown.unrecognizedArmorNames,
      changed: breakdown.armorClass !== stats.armor_class,
    });
  }

  return plans;
}

/** One line per character, so a dry run can be read rather than trusted. */
export function formatArmorClassPlan(plan: ArmorClassPlan): string {
  const worn = [plan.armorName ?? 'no armor', plan.hasShield ? 'shield' : null]
    .filter(Boolean)
    .join(' + ');
  const dexterity = `${plan.dexterityModifier >= 0 ? '+' : ''}${plan.dexterityModifier}`;
  const previous = plan.previousArmorClass ?? 'none';
  return `${plan.characterName} (${plan.characterId}): AC ${previous} -> ${plan.armorClass} [${worn}, DEX ${dexterity}]`;
}

async function selectAll<T>(
  client: SupabaseClient,
  table: string,
  columns: string,
): Promise<T[]> {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`Could not read ${table}: ${errorMessage(error)}`);
  return (data ?? []) as unknown as T[];
}

export async function runBackfill(options: {
  dryRun: boolean;
  client: SupabaseClient;
}): Promise<BackfillSummary> {
  const [characters, stats, equipment, inventory] = await Promise.all([
    selectAll<CharacterRow>(options.client, 'characters', 'id, name'),
    selectAll<CharacterStatsRow>(
      options.client,
      'character_stats',
      'character_id, dexterity, armor_class',
    ),
    selectAll<EquipmentRow>(
      options.client,
      'character_equipment',
      'character_id, item_name, item_type, equipped',
    ),
    selectAll<InventoryRow>(
      options.client,
      'inventory_items',
      'character_id, name, item_type, is_equipped',
    ),
  ]);

  const plans = planArmorClassBackfill({ characters, stats, equipment, inventory });
  const changed = plans.filter((plan) => plan.changed);
  const summary: BackfillSummary = {
    characters: stats.length,
    equipmentDriven: plans.length,
    changed: changed.length,
    applied: 0,
    failed: 0,
  };

  for (const plan of changed) {
    console.log(`${options.dryRun ? 'Would update' : 'Updating'} ${formatArmorClassPlan(plan)}`);
    if (options.dryRun) continue;

    const { error } = await options.client
      .from('character_stats')
      .update({ armor_class: plan.armorClass })
      .eq('character_id', plan.characterId);

    if (error) {
      summary.failed += 1;
      console.error(`Failed ${plan.characterId}: ${errorMessage(error)}`);
    } else {
      summary.applied += 1;
    }
  }

  return summary;
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

function printSummary(summary: BackfillSummary, dryRun: boolean): void {
  console.log('\nArmor class backfill summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Characters with stats: ${summary.characters}`);
  console.log(`  Equipment-derived AC: ${summary.equipmentDriven}`);
  console.log(`  Needing repair: ${summary.changed}`);
  console.log(`  Updated: ${summary.applied}`);
  console.log(`  Failed: ${summary.failed}`);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: { dryRun: boolean };
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(errorMessage(error));
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
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
    console.error(`Armor class backfill failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
