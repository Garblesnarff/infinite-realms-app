#!/usr/bin/env bun
/* eslint-disable max-lines */
/* eslint-disable no-console */
/**
 * #253: DRY-RUN-ONLY counter for the #203 racial-bonus backfill.
 *
 * *** NOT APPLIED ANYWHERE. This script performs ZERO database writes: it only ***
 * *** reads and prints counts. Running any repair on prod needs Rob's typed line. ***
 *
 * After PR #250 (merged 2026-10-11T08:29:14Z, "fix(creation): keep racial ability
 * bonuses on save (#203)"), wizard-created characters store final ability scores
 * (racial bonus applied once at creation). Characters saved before the fix still
 * hold base scores, so their AC, HP and saves read low.
 *
 * This script counts how many such rows exist so the team can decide whether a
 * real backfill is worth doing. It deliberately has no --apply path and imports
 * no write-capable client: if the counts justify it, a follow-up PR adds the
 * guarded apply step.
 *
 * What it counts (counts only — no names, ids, or other personal data):
 *   - scanned: all characters rows read.
 *   - candidates: created before the #250 merge, excluding starter-flow rows
 *     (game_sessions with a starter_campaign_id) and any --exclude-campaign ids
 *     (for seeded campaigns).
 *   - needingRepair: fixed race/subrace bonuses missing from stored scores.
 *     Reported per race/subrace with old -> new score deltas (capped at 20) and
 *     recomputed AC / level-1 HP, mirroring transformAbilityScoresForStorage.
 *   - alreadyCorrect: adding the fixed bonuses changes nothing for this row
 *     (e.g. every bonused ability is already at the 20 cap). Pre/post-fix is
 *     determined by the created_at cutoff, not by comparing scores: pre-fix
 *     wizard saves always wrote base scores, so stored+bonus is the correct
 *     repair inside the candidate set.
 *   - needsManualReview: Half-Elf / Variant Human. The chosen +1s were never
 *     persisted (transformCharacterForStorage does not write racialAbilityChoices),
 *     so they cannot be reconstructed from the DB; a repair would be incomplete.
 *   - skipped: race/subrace not resolvable against src/data/races, missing
 *     character_stats row, or null stored scores.
 *
 * Usage:
 *   bun scripts/backfill-racial-ability-bonuses.ts [--exclude-campaign <id> ...]
 *
 * Requires SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY for
 * read-only access. server-bun/.env is loaded as a fallback like the other
 * backfill scripts.
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';

import { abilityScoreModifier } from '../shared/armor-class.ts';
import { findSrdClass } from '../shared/srd-class-data.ts';
import { lookupRaces } from '../src/data/races/index.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

/** PR #250 merge timestamp: wizard saves before this hold base ability scores. */
export const RACIAL_BONUS_FIX_CUTOFF_ISO = '2026-10-11T08:29:14Z';

const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

type AbilityName = (typeof ABILITIES)[number];
type AbilityBonusMap = Record<AbilityName, number>;

const zeroBonuses = (): AbilityBonusMap => ({
  strength: 0,
  dexterity: 0,
  constitution: 0,
  intelligence: 0,
  wisdom: 0,
  charisma: 0,
});

function toBonusMap(increase: Partial<Record<string, number>> | undefined): AbilityBonusMap {
  const out = zeroBonuses();
  if (!increase) return out;
  for (const ability of ABILITIES) {
    const value = increase[ability];
    if (typeof value === 'number' && Number.isFinite(value)) out[ability] = value;
  }
  return out;
}

interface SubraceLookup {
  name: string;
  bonuses: AbilityBonusMap;
  toughness: boolean;
  hasChoices: boolean;
}

interface RaceLookup {
  raceName: string;
  bonuses: AbilityBonusMap;
  toughness: boolean;
  hasChoices: boolean;
  subraces: Map<string, SubraceLookup>;
}

const normalizeName = (name: string): string => name.trim().toLowerCase();

/**
 * Build the stored-name -> fixed-bonus lookup from the real race data
 * (src/data/races), so the script can never drift from what the wizard offers.
 * `hasChoices` marks races whose bonus partly comes from player choices that are
 * not persisted (Half-Elf, Variant Human) — those rows need manual review.
 */
export function buildRaceBonusLookup(): Map<string, RaceLookup> {
  const map = new Map<string, RaceLookup>();
  for (const race of lookupRaces) {
    const subraces = new Map<string, SubraceLookup>();
    for (const subrace of race.subraces ?? []) {
      subraces.set(normalizeName(subrace.name), {
        name: subrace.name,
        bonuses: toBonusMap(subrace.abilityScoreIncrease),
        toughness: (subrace.traits ?? []).includes('Dwarven Toughness'),
        hasChoices: subrace.id === 'variant-human',
      });
    }
    map.set(normalizeName(race.name), {
      raceName: race.name,
      bonuses: toBonusMap(race.abilityScoreIncrease),
      toughness: (race.traits ?? []).includes('Dwarven Toughness'),
      hasChoices: race.id === 'half-elf',
      subraces,
    });
  }
  return map;
}

export interface BackfillCharacterRow {
  id: string;
  race: string | null;
  subrace: string | null;
  class: string | null;
  level: number | null;
  created_at: string | null;
}

export interface BackfillStatsRow {
  character_id: string;
  strength: number | null;
  dexterity: number | null;
  constitution: number | null;
  intelligence: number | null;
  wisdom: number | null;
  charisma: number | null;
  armor_class: number | null;
  max_hit_points: number | null;
  current_hit_points: number | null;
}

export interface RepairPlan {
  raceName: string;
  subraceName: string | null;
  oldScores: AbilityBonusMap;
  newScores: AbilityBonusMap;
  oldArmorClass: number | null;
  newArmorClass: number;
  oldMaxHitPoints: number | null;
  /** Null when the class cannot be resolved or the character is past level 1. */
  newMaxHitPoints: number | null;
  toughnessApplied: boolean;
}

export type RowVerdict =
  | { kind: 'needsRepair'; plan: RepairPlan }
  | { kind: 'alreadyCorrect' }
  | { kind: 'needsManualReview'; reason: string }
  | { kind: 'skipped'; reason: string };

function storedScores(stats: BackfillStatsRow): AbilityBonusMap | null {
  const out = zeroBonuses();
  for (const ability of ABILITIES) {
    const value = stats[ability];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out[ability] = value;
  }
  return out;
}

/**
 * Decide what a single pre-fix character row needs. Pure: no I/O, so it can be
 * checked without a database. Mirrors the save path: bonuses folded into scores
 * once, capped at 20, AC = 10 + DEX mod, level-1 HP = hit die + CON mod +
 * Dwarven Toughness (see transformAbilityScoresForStorage and #250).
 */
export function planRow(
  character: BackfillCharacterRow,
  stats: BackfillStatsRow | undefined,
  lookup: Map<string, RaceLookup>,
): RowVerdict {
  if (!stats) return { kind: 'skipped', reason: 'character_stats row is missing' };

  const raceName = character.race?.trim();
  if (!raceName) return { kind: 'skipped', reason: 'race is null or empty' };
  const race = lookup.get(normalizeName(raceName));
  if (!race) return { kind: 'skipped', reason: `race "${raceName}" not in src/data/races` };

  let subrace: SubraceLookup | null = null;
  const subraceName = character.subrace?.trim() || null;
  if (subraceName) {
    const found = race.subraces.get(normalizeName(subraceName));
    if (!found)
      return { kind: 'skipped', reason: `subrace "${subraceName}" not under race "${raceName}"` };
    subrace = found;
  }

  if (race.hasChoices || subrace?.hasChoices) {
    return {
      kind: 'needsManualReview',
      reason:
        'Half-Elf / Variant Human: chosen +1s were never persisted ' +
        '(transformCharacterForStorage does not write racialAbilityChoices), ' +
        'so the full bonus cannot be reconstructed from the DB',
    };
  }

  const stored = storedScores(stats);
  if (!stored) return { kind: 'skipped', reason: 'stored ability score is null' };

  const total: AbilityBonusMap = zeroBonuses();
  for (const ability of ABILITIES) {
    total[ability] = race.bonuses[ability] + (subrace?.bonuses[ability] ?? 0);
  }

  const newScores = zeroBonuses();
  let changed = false;
  for (const ability of ABILITIES) {
    newScores[ability] = Math.min(stored[ability] + total[ability], 20);
    if (newScores[ability] !== stored[ability]) changed = true;
  }
  if (!changed) return { kind: 'alreadyCorrect' };

  const toughness = race.toughness || subrace?.toughness || false;
  const newArmorClass = 10 + abilityScoreModifier(newScores.dexterity);

  let newMaxHitPoints: number | null = null;
  if (character.level === 1) {
    const classData = findSrdClass(character.class);
    if (classData) {
      newMaxHitPoints =
        classData.hitDie + abilityScoreModifier(newScores.constitution) + (toughness ? 1 : 0);
    }
  }

  return {
    kind: 'needsRepair',
    plan: {
      raceName: race.raceName,
      subraceName,
      oldScores: stored,
      newScores,
      oldArmorClass: stats.armor_class,
      newArmorClass,
      oldMaxHitPoints: stats.max_hit_points,
      newMaxHitPoints,
      toughnessApplied: toughness,
    },
  };
}

export interface RacialBonusBackfillSummary {
  scanned: number;
  excludedStarterFlow: number;
  excludedSeededCampaign: number;
  candidates: number;
  needingRepair: number;
  alreadyCorrect: number;
  needsManualReview: number;
  skipped: number;
  /** needingRepair grouped by "Race / Subrace". */
  byRace: Map<string, number>;
  /** skipped / manual-review grouped by reason. */
  byReason: Map<string, number>;
  /** needingRepair rows whose level-1 HP could not be recomputed (class unknown). */
  hpNotRecomputable: number;
}

export function summarizeVerdicts(
  verdicts: RowVerdict[],
  scanned: number,
  excludedStarterFlow: number,
  excludedSeededCampaign: number,
): RacialBonusBackfillSummary {
  const summary: RacialBonusBackfillSummary = {
    scanned,
    excludedStarterFlow,
    excludedSeededCampaign,
    candidates: verdicts.length,
    needingRepair: 0,
    alreadyCorrect: 0,
    needsManualReview: 0,
    skipped: 0,
    byRace: new Map(),
    byReason: new Map(),
    hpNotRecomputable: 0,
  };
  const bump = (map: Map<string, number>, key: string): void => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };
  for (const verdict of verdicts) {
    switch (verdict.kind) {
      case 'needsRepair': {
        summary.needingRepair += 1;
        const label = verdict.plan.subraceName
          ? `${verdict.plan.raceName} / ${verdict.plan.subraceName}`
          : verdict.plan.raceName;
        bump(summary.byRace, label);
        if (verdict.plan.newMaxHitPoints === null) summary.hpNotRecomputable += 1;
        break;
      }
      case 'alreadyCorrect':
        summary.alreadyCorrect += 1;
        break;
      case 'needsManualReview':
        summary.needsManualReview += 1;
        bump(summary.byReason, verdict.reason);
        break;
      case 'skipped':
        summary.skipped += 1;
        bump(summary.byReason, verdict.reason);
        break;
    }
  }
  return summary;
}

export interface BackfillInput {
  characters: BackfillCharacterRow[];
  stats: BackfillStatsRow[];
  starterCharacterIds: Set<string>;
  excludedCampaignCharacterIds: Set<string>;
  cutoffIso?: string;
}

/** Build per-row verdicts for the candidate set. Pure: no I/O. */
export function planRacialBonusBackfill(input: BackfillInput): {
  verdicts: RowVerdict[];
  summary: RacialBonusBackfillSummary;
} {
  const cutoff = input.cutoffIso ?? RACIAL_BONUS_FIX_CUTOFF_ISO;
  const cutoffMs = Date.parse(cutoff);
  const lookup = buildRaceBonusLookup();
  const statsById = new Map(input.stats.map((row) => [row.character_id, row]));

  let excludedStarterFlow = 0;
  let excludedSeededCampaign = 0;
  const verdicts: RowVerdict[] = [];

  for (const character of input.characters) {
    if (input.starterCharacterIds.has(character.id)) {
      excludedStarterFlow += 1;
      continue;
    }
    if (input.excludedCampaignCharacterIds.has(character.id)) {
      excludedSeededCampaign += 1;
      continue;
    }
    // No created_at (or unparseable): cannot prove pre-fix, so include it — the
    // stored-vs-expected self-check in planRow is the real determinant.
    // Compare as timestamps: Supabase returns "+00:00" offsets while the cutoff
    // uses "Z", and those do not compare correctly as raw strings.
    if (character.created_at) {
      const createdMs = Date.parse(character.created_at);
      if (!Number.isNaN(createdMs) && createdMs >= cutoffMs) continue;
    }
    verdicts.push(planRow(character, statsById.get(character.id), lookup));
  }

  return {
    verdicts,
    summary: summarizeVerdicts(
      verdicts,
      input.characters.length,
      excludedStarterFlow,
      excludedSeededCampaign,
    ),
  };
}

function printSummary(summary: RacialBonusBackfillSummary): void {
  console.log('\n#253 racial-bonus backfill — DRY RUN (no writes performed)');
  console.log(`  Cutoff: created before ${RACIAL_BONUS_FIX_CUTOFF_ISO} (PR #250 merge)`);
  console.log(`  Characters scanned: ${summary.scanned}`);
  console.log(`  Excluded (starter flow via game_sessions): ${summary.excludedStarterFlow}`);
  console.log(`  Excluded (seeded campaigns): ${summary.excludedSeededCampaign}`);
  console.log(`  Candidates: ${summary.candidates}`);
  console.log(`  Needing repair: ${summary.needingRepair}`);
  console.log(`  Already correct: ${summary.alreadyCorrect}`);
  console.log(`  Needs manual review (choices not stored): ${summary.needsManualReview}`);
  console.log(`  Skipped: ${summary.skipped}`);
  if (summary.byRace.size > 0) {
    console.log('\n  Needing repair by race:');
    for (const [race, count] of [...summary.byRace.entries()].sort()) {
      console.log(`    ${race}: ${count}`);
    }
  }
  if (summary.hpNotRecomputable > 0) {
    console.log(
      `  Rows needing repair whose level-1 HP cannot be recomputed (class unknown or level > 1): ${summary.hpNotRecomputable}`,
    );
  }
  if (summary.byReason.size > 0) {
    console.log('\n  Skipped / manual-review reasons:');
    for (const [reason, count] of [...summary.byReason.entries()].sort()) {
      console.log(`    (${count}) ${reason}`);
    }
  }
}

async function selectRows<T>(client: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const { data, error } = await client.from(table).select(columns);
  if (error) throw new Error(`Could not read ${table}: ${error.message}`);
  return (data ?? []) as unknown as T[];
}

export function parseCliArgs(argv: string[]): { excludedCampaignIds: string[] } {
  const excludedCampaignIds: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--exclude-campaign') {
      const id = argv[i + 1];
      if (!id || id.startsWith('--')) throw new Error('--exclude-campaign needs an id');
      excludedCampaignIds.push(id);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: bun scripts/backfill-racial-ability-bonuses.ts [--exclude-campaign <id> ...]\n' +
          'Dry run only: prints counts, performs no writes.',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { excludedCampaignIds };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: { excludedCampaignIds: string[] };
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      'Usage: bun scripts/backfill-racial-ability-bonuses.ts [--exclude-campaign <id> ...]',
    );
    process.exitCode = 1;
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY.');
    console.error('This script is read-only; it never writes.');
    process.exitCode = 1;
    return;
  }
  const client = createClient(supabaseUrl, serviceRoleKey);

  try {
    const [characters, stats, sessions] = await Promise.all([
      selectRows<BackfillCharacterRow>(
        client,
        'characters',
        'id, race, subrace, class, level, created_at',
      ),
      selectRows<BackfillStatsRow>(
        client,
        'character_stats',
        'character_id, strength, dexterity, constitution, intelligence, wisdom, charisma, armor_class, max_hit_points, current_hit_points',
      ),
      selectRows<{ character_id: string | null; campaign_id: string | null; starter_campaign_id: string | null }>(
        client,
        'game_sessions',
        'character_id, campaign_id, starter_campaign_id',
      ),
    ]);

    // Starter-flow characters (premades): instantiated from starter templates.
    const starterIds = new Set<string>();
    for (const row of sessions) {
      if (row.character_id && row.starter_campaign_id) starterIds.add(row.character_id);
    }

    const excludedCampaignCharacterIds = new Set<string>();
    if (options.excludedCampaignIds.length > 0) {
      for (const row of sessions) {
        if (
          row.character_id &&
          row.campaign_id &&
          options.excludedCampaignIds.includes(row.campaign_id)
        ) {
          excludedCampaignCharacterIds.add(row.character_id);
        }
      }
    }

    const { summary } = planRacialBonusBackfill({
      characters,
      stats,
      starterCharacterIds: starterIds,
      excludedCampaignCharacterIds,
    });
    printSummary(summary);

    console.log(
      '\nReminder: DRY RUN only — nothing was written. ' +
        "Running any repair on prod needs Rob's typed line (#253).",
    );
  } catch (error) {
    console.error(
      `Racial-bonus backfill dry run failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
