#!/usr/bin/env bun
/* eslint-disable max-lines */
/* eslint-disable no-console */
/**
 * Reconcile starter-character spell columns after the known/prepared writer fix for #1928.
 *
 * The source relationship is intentionally narrow: a character must be attached to a starter
 * session and still match exactly one source starter template by campaign, name, and class. A
 * template's authored spell list is preferred; missing quota entries come from the shared 2014
 * SRD fallback. Existing spell values are never removed or replaced. The divergence predicate is
 * only an under-quota predicate, which keeps player-customized rows safe when their provenance
 * cannot be proven.
 *
 * Dry-run is the default. It prints the predicate and complete old -> new spell columns before
 * any write. `--apply` is separately gated, uses one transaction per character, rechecks the
 * reviewed old state while holding the row lock, and stamps characters.updated_at.
 *
 * Usage:
 *   bun scripts/backfill-starter-spell-columns.ts
 *   DATABASE_URL=postgres://... bun scripts/backfill-starter-spell-columns.ts --apply
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import postgres from 'postgres';

import {
  buildStarterSpellSeed,
  getStarterSpellQuotas,
  type StarterCharacterTemplateLike,
  type StarterTemplateSpellLists,
} from '../src/services/character/starter-character-seeding.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

type PostgresClient = ReturnType<typeof postgres>;

export interface StarterSessionRow {
  character_id: string | null;
  starter_campaign_id: string | null;
}

export interface StarterCharacterRow {
  id: string;
  name: string | null;
  class: string | null;
  level: number | null;
  known_spells: string | null;
  prepared_spells: string | null;
}

export interface StarterCharacterStatsRow {
  character_id: string;
  strength: number | null;
  dexterity: number | null;
  constitution: number | null;
  intelligence: number | null;
  wisdom: number | null;
  charisma: number | null;
}

export type StarterTemplateRow = StarterCharacterTemplateLike & {
  id?: string;
  starter_campaign_id: string;
  template_key: string;
};

export interface StarterSpellCandidate {
  character: StarterCharacterRow;
  stats: StarterCharacterStatsRow;
  starterCampaignId: string;
  template: StarterTemplateRow;
}

export interface SkippedStarterSpellRow {
  characterId: string;
  characterName: string;
  characterClass: string | null;
  reason: string;
}

export interface StarterSpellBackfillPlan {
  characterId: string;
  characterName: string;
  characterClass: string;
  level: number;
  starterCampaignId: string;
  templateKey: string;
  source: 'template + SRD fallback' | 'SRD fallback';
  knownQuota: number;
  preparedQuota: number;
  previousKnownSpells: string | null;
  previousPreparedSpells: string | null;
  nextKnownSpells: string | null;
  nextPreparedSpells: string | null;
  addedKnownSpells: string[];
  addedPreparedSpells: string[];
  knownUniqueCount: number;
  preparedUniqueCount: number;
  changed: boolean;
}

export interface StarterSpellBackfillInput {
  sessions: StarterSessionRow[];
  characters: StarterCharacterRow[];
  stats: StarterCharacterStatsRow[];
  templates: StarterTemplateRow[];
}

export interface StarterSpellBackfillResult {
  candidates: StarterSpellCandidate[];
  plans: StarterSpellBackfillPlan[];
  skipped: SkippedStarterSpellRow[];
}

export interface StarterSpellBackfillSummary {
  scanned: number;
  matched: number;
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

function displayName(character: StarterCharacterRow): string {
  return character.name?.trim() || character.id;
}

function normalizeIdentity(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function sameIdentity(left: string | null | undefined, right: string | null | undefined): boolean {
  return normalizeIdentity(left) === normalizeIdentity(right);
}

function parseSpellList(value: string | null): string[] {
  if (!value || value.trim() === '') return [];
  const normalizedValue = value.trim();
  if (normalizedValue.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(normalizedValue);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map((item) => item.trim());
      }
    } catch {
      // Fall through to the legacy CSV parser so malformed persisted data remains visible.
    }
  }
  return normalizedValue
    .split(',')
    .map((spell) => spell.trim())
    .filter((spell) => spell.length > 0);
}

function spellKey(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueSpellIds(spellIds: string[]): string[] {
  const seen = new Set<string>();
  return spellIds.filter((spellId) => {
    const key = spellKey(spellId);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSpellCount(value: string | null): number {
  return uniqueSpellIds(parseSpellList(value)).length;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim());
  }
  if (typeof value !== 'string' || value.trim() === '') return undefined;

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          .map((item) => item.trim())
      : undefined;
  } catch {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string' && value.trim() !== '') {
    try {
      return asObject(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** Read both the forward-compatible nested shape and possible future snake_case columns. */
export function getTemplateSpellLists(template: StarterTemplateRow): StarterTemplateSpellLists {
  const raw = template as unknown as Record<string, unknown>;
  const nested = Array.isArray(raw.spells) ? undefined : asObject(raw.spells);
  const nestedKnown = nested?.knownSpells ?? nested?.known_spells;
  const nestedPrepared = nested?.preparedSpells ?? nested?.prepared_spells;
  const nestedCantrips = nested?.cantrips;

  return {
    cantrips: asStringArray(nestedCantrips) || asStringArray(raw.cantrips) || undefined,
    knownSpells:
      asStringArray(nestedKnown) ||
      asStringArray(raw.knownSpells) ||
      asStringArray(raw.known_spells) ||
      (Array.isArray(raw.spells) ? asStringArray(raw.spells) : undefined) ||
      undefined,
    preparedSpells:
      asStringArray(nestedPrepared) ||
      asStringArray(raw.preparedSpells) ||
      asStringArray(raw.prepared_spells) ||
      undefined,
  };
}

function abilityScoresFromStats(stats: StarterCharacterStatsRow): Record<string, number> | null {
  const entries = [
    ['strength', stats.strength],
    ['dexterity', stats.dexterity],
    ['constitution', stats.constitution],
    ['intelligence', stats.intelligence],
    ['wisdom', stats.wisdom],
    ['charisma', stats.charisma],
  ] as const;
  if (entries.some(([, value]) => value === null)) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function appendToQuota(
  previous: string | null,
  candidates: string[],
  quota: number,
): { next: string | null; added: string[]; uniqueCount: number } {
  const existing = parseSpellList(previous);
  const existingKeys = new Set(existing.map(spellKey));
  const next = [...existing];
  const added: string[] = [];

  for (const candidate of uniqueSpellIds(candidates)) {
    if (existingKeys.size >= quota) break;
    const key = spellKey(candidate);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    next.push(candidate);
    added.push(candidate);
  }

  return {
    next: added.length > 0 ? next.join(', ') : previous,
    added,
    uniqueCount: existingKeys.size,
  };
}

function candidatesForTemplate(
  template: StarterTemplateRow,
  lists: StarterTemplateSpellLists,
  abilityScores: Record<string, number>,
  level: number,
): {
  quotas: { known: number; prepared: number };
  source: StarterSpellBackfillPlan['source'];
  knownCandidates: string[];
  preparedCandidates: string[];
} {
  const quotas = getStarterSpellQuotas(template.class, level, abilityScores);
  const fallbackTemplate: StarterCharacterTemplateLike = {
    ...template,
    level,
    spells: undefined,
    cantrips: undefined,
    knownSpells: undefined,
    preparedSpells: undefined,
    known_spells: undefined,
    prepared_spells: undefined,
  };
  const fallbackSeed = buildStarterSpellSeed(fallbackTemplate, abilityScores);

  // A prepared-only template may have been authored with one generic spell list. Treat that list
  // as the prepared list when no separate prepared list exists; it remains an authored preference.
  const effectiveLists: StarterTemplateSpellLists = {
    ...lists,
    preparedSpells:
      lists.preparedSpells && lists.preparedSpells.length > 0
        ? lists.preparedSpells
        : quotas.prepared > 0
          ? lists.knownSpells
          : undefined,
  };
  const hasAuthoredList =
    (effectiveLists.knownSpells?.length || 0) > 0 ||
    (effectiveLists.preparedSpells?.length || 0) > 0;
  const curatedSeed = buildStarterSpellSeed(
    { ...template, level, spells: effectiveLists },
    abilityScores,
  );

  const knownCandidates = uniqueSpellIds([...curatedSeed.knownSpells, ...fallbackSeed.knownSpells]);
  const preparedCandidates = uniqueSpellIds([
    ...curatedSeed.preparedSpells,
    ...fallbackSeed.preparedSpells,
    ...fallbackSeed.knownSpells,
  ]);

  return {
    quotas,
    source: hasAuthoredList ? 'template + SRD fallback' : 'SRD fallback',
    knownCandidates,
    preparedCandidates,
  };
}

function findTemplateMatches(
  character: StarterCharacterRow,
  starterCampaignId: string,
  templates: StarterTemplateRow[],
): StarterTemplateRow[] {
  return templates.filter(
    (template) =>
      template.starter_campaign_id === starterCampaignId &&
      sameIdentity(template.name, character.name) &&
      sameIdentity(template.class, character.class),
  );
}

/** Find starter characters that still have an authoritative source template relationship. */
export function findStarterSpellCandidates(input: StarterSpellBackfillInput): {
  candidates: StarterSpellCandidate[];
  skipped: SkippedStarterSpellRow[];
} {
  const charactersById = new Map(input.characters.map((row) => [row.id, row]));
  const statsByCharacterId = new Map(input.stats.map((row) => [row.character_id, row]));
  const candidatesByCharacterId = new Map<string, StarterSpellCandidate>();
  const ambiguousCharacterIds = new Set<string>();
  const skipped: SkippedStarterSpellRow[] = [];

  for (const session of input.sessions) {
    if (!session.character_id || !session.starter_campaign_id) continue;

    const character = charactersById.get(session.character_id);
    if (!character) {
      skipped.push({
        characterId: session.character_id,
        characterName: session.character_id,
        characterClass: null,
        reason: 'character row is missing',
      });
      continue;
    }
    if (ambiguousCharacterIds.has(character.id)) continue;
    const stats = statsByCharacterId.get(character.id);
    if (!stats) {
      skipped.push({
        characterId: character.id,
        characterName: displayName(character),
        characterClass: character.class,
        reason: 'character_stats row is missing; refusing to guess the casting ability',
      });
      continue;
    }

    const matches = findTemplateMatches(character, session.starter_campaign_id, input.templates);
    if (matches.length === 0) {
      skipped.push({
        characterId: character.id,
        characterName: displayName(character),
        characterClass: character.class,
        reason: 'no unique source starter template matched campaign, name, and class',
      });
      ambiguousCharacterIds.add(character.id);
      candidatesByCharacterId.delete(character.id);
      continue;
    }
    if (matches.length > 1) {
      skipped.push({
        characterId: character.id,
        characterName: displayName(character),
        characterClass: character.class,
        reason: 'multiple source starter templates matched; refusing ambiguous repair',
      });
      ambiguousCharacterIds.add(character.id);
      candidatesByCharacterId.delete(character.id);
      continue;
    }

    const candidate: StarterSpellCandidate = {
      character,
      stats,
      starterCampaignId: session.starter_campaign_id,
      template: matches[0],
    };
    const previous = candidatesByCharacterId.get(character.id);
    if (
      previous &&
      (previous.starterCampaignId !== candidate.starterCampaignId ||
        previous.template.template_key !== candidate.template.template_key)
    ) {
      skipped.push({
        characterId: character.id,
        characterName: displayName(character),
        characterClass: character.class,
        reason: 'character is linked to multiple different starter templates; refusing ambiguity',
      });
      ambiguousCharacterIds.add(character.id);
      candidatesByCharacterId.delete(character.id);
      continue;
    }
    candidatesByCharacterId.set(character.id, candidate);
  }

  return { candidates: [...candidatesByCharacterId.values()], skipped };
}

function makePlan(candidate: StarterSpellCandidate): StarterSpellBackfillPlan {
  const { character, stats, template } = candidate;
  if (!character.class) throw new Error(`Character ${character.id} has no class.`);

  const level = Math.max(1, character.level || 1);
  const abilityScores = abilityScoresFromStats(stats);
  if (!abilityScores) {
    throw new Error(`Character ${character.id} has incomplete ability scores.`);
  }

  const lists = getTemplateSpellLists(template);
  const spellCandidates = candidatesForTemplate(template, lists, abilityScores, level);
  const known = appendToQuota(
    character.known_spells,
    spellCandidates.knownCandidates,
    spellCandidates.quotas.known,
  );
  const knownAfter = parseSpellList(known.next);
  const knownKeys = new Set(knownAfter.map(spellKey));
  const preparedCandidates =
    normalizeIdentity(character.class) === 'wizard'
      ? spellCandidates.preparedCandidates.filter((spell) => knownKeys.has(spellKey(spell)))
      : spellCandidates.preparedCandidates;
  const prepared = appendToQuota(
    character.prepared_spells,
    preparedCandidates,
    spellCandidates.quotas.prepared,
  );

  return {
    characterId: character.id,
    characterName: displayName(character),
    characterClass: character.class,
    level,
    starterCampaignId: candidate.starterCampaignId,
    templateKey: template.template_key,
    source: spellCandidates.source,
    knownQuota: spellCandidates.quotas.known,
    preparedQuota: spellCandidates.quotas.prepared,
    previousKnownSpells: character.known_spells,
    previousPreparedSpells: character.prepared_spells,
    nextKnownSpells: known.next,
    nextPreparedSpells: prepared.next,
    addedKnownSpells: known.added,
    addedPreparedSpells: prepared.added,
    knownUniqueCount: known.uniqueCount,
    preparedUniqueCount: prepared.uniqueCount,
    changed: known.added.length > 0 || prepared.added.length > 0,
  };
}

/** Build the add-only plan and keep malformed/incomplete rows visible to the operator. */
export function planStarterSpellBackfill(
  input: StarterSpellBackfillInput,
): StarterSpellBackfillResult {
  const { candidates, skipped } = findStarterSpellCandidates(input);
  const plans: StarterSpellBackfillPlan[] = [];
  const planSkipped = [...skipped];

  for (const candidate of candidates) {
    try {
      plans.push(makePlan(candidate));
    } catch (error) {
      planSkipped.push({
        characterId: candidate.character.id,
        characterName: displayName(candidate.character),
        characterClass: candidate.character.class,
        reason: errorMessage(error),
      });
    }
  }

  return { candidates, plans, skipped: planSkipped };
}

function formatSpellColumn(value: string | null): string {
  return value && value.trim() !== '' ? value : value === null ? 'NULL' : '(empty)';
}

/** Print the divergence predicate before any apply transaction can run. */
export function formatStarterSpellBackfillPlan(plan: StarterSpellBackfillPlan): string {
  const predicate =
    `unique known ${plan.knownUniqueCount}/${plan.knownQuota}, ` +
    `unique prepared ${plan.preparedUniqueCount}/${plan.preparedQuota}`;
  const action = plan.changed
    ? `add known [${plan.addedKnownSpells.join(', ') || 'none'}]; ` +
      `add prepared [${plan.addedPreparedSpells.join(', ') || 'none'}]`
    : 'already at or above quota';
  return (
    `${plan.characterName} (${plan.characterId}) [${plan.characterClass} L${plan.level}; ` +
    `${plan.starterCampaignId}/${plan.templateKey}; ${plan.source}]: ` +
    `predicate ${predicate}; ` +
    `known ${formatSpellColumn(plan.previousKnownSpells)} -> ${formatSpellColumn(plan.nextKnownSpells)}; ` +
    `prepared ${formatSpellColumn(plan.previousPreparedSpells)} -> ` +
    `${formatSpellColumn(plan.nextPreparedSpells)}; ${action}`
  );
}

function formatSkippedRow(row: SkippedStarterSpellRow): string {
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

interface CurrentCharacterRow {
  id: string;
  name: string;
  class: string | null;
  level: number;
  known_spells: string | null;
  prepared_spells: string | null;
}

function currentCharacterMatches(
  row: CurrentCharacterRow,
  plan: StarterSpellBackfillPlan,
): boolean {
  return (
    row.name === plan.characterName &&
    sameIdentity(row.class, plan.characterClass) &&
    row.level === plan.level &&
    row.known_spells === plan.previousKnownSpells &&
    row.prepared_spells === plan.previousPreparedSpells
  );
}

/** Apply exactly one reviewed plan atomically, with an optimistic old-state check. */
async function applyPlanAtomically(
  sql: PostgresClient,
  plan: StarterSpellBackfillPlan,
): Promise<void> {
  await sql.begin(async (transaction) => {
    const currentRows = await transaction<CurrentCharacterRow[]>`
      SELECT id, name, class, level, known_spells, prepared_spells
      FROM characters
      WHERE id = ${plan.characterId}
      FOR UPDATE
    `;
    const current = currentRows[0];
    if (!current) throw new Error(`Character ${plan.characterId} was not found.`);
    if (!currentCharacterMatches(current, plan)) {
      throw new Error(
        `Stored spell state for ${plan.characterId} changed after dry-run; transaction rolled back.`,
      );
    }

    const updatedRows = await transaction<{ id: string }[]>`
      UPDATE characters
      SET known_spells = ${plan.nextKnownSpells},
          prepared_spells = ${plan.nextPreparedSpells},
          updated_at = NOW()
      WHERE id = ${plan.characterId}
        AND known_spells IS NOT DISTINCT FROM ${plan.previousKnownSpells}
        AND prepared_spells IS NOT DISTINCT FROM ${plan.previousPreparedSpells}
      RETURNING id, known_spells, prepared_spells
    `;
    if (updatedRows.length !== 1) {
      throw new Error(`Expected one updated characters row for ${plan.characterId}.`);
    }
    const updated = updatedRows[0] as {
      id: string;
      known_spells: string | null;
      prepared_spells: string | null;
    };
    if (
      updated.known_spells !== plan.nextKnownSpells ||
      updated.prepared_spells !== plan.nextPreparedSpells ||
      uniqueSpellCount(updated.known_spells) < plan.knownQuota ||
      uniqueSpellCount(updated.prepared_spells) < plan.preparedQuota
    ) {
      throw new Error(
        `Updated spell counts did not meet the reviewed plan for ${plan.characterId}.`,
      );
    }
  });
}

export async function runBackfill(options: {
  dryRun: boolean;
  client: SupabaseClient;
}): Promise<StarterSpellBackfillSummary> {
  const sessions = await selectRows<StarterSessionRow>(
    options.client,
    'game_sessions',
    'character_id, starter_campaign_id',
  );
  const starterSessions = sessions.filter(
    (row) => row.character_id !== null && row.starter_campaign_id !== null,
  );
  if (starterSessions.length === 0) {
    throw new Error('No starter-session characters found; refusing spell repair.');
  }

  const campaignIds = [
    ...new Set(
      starterSessions
        .map((row) => row.starter_campaign_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [characters, stats, templates] = await Promise.all([
    selectRows<StarterCharacterRow>(
      options.client,
      'characters',
      'id, name, class, level, known_spells, prepared_spells',
    ),
    selectRows<StarterCharacterStatsRow>(
      options.client,
      'character_stats',
      'character_id, strength, dexterity, constitution, intelligence, wisdom, charisma',
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
  ]);

  const plan = planStarterSpellBackfill({
    sessions: starterSessions,
    characters,
    stats,
    templates,
  });
  const changedPlans = plan.plans.filter((row) => row.changed);
  const summary: StarterSpellBackfillSummary = {
    scanned: starterSessions.length,
    matched: plan.plans.length,
    needingRepair: changedPlans.length,
    alreadyCorrect: plan.plans.length - changedPlans.length,
    skipped: plan.skipped.length,
    applied: 0,
    failed: 0,
  };

  console.log('\nStarter spell backfill divergence plan (add-only)');
  console.log(
    'Predicate: starter session + exactly one matching source template + unique known/prepared below quota; preserve every existing token, add only.',
  );
  for (const row of plan.plans) console.log(formatStarterSpellBackfillPlan(row));
  for (const row of plan.skipped) console.log(formatSkippedRow(row));

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

function printSummary(summary: StarterSpellBackfillSummary, dryRun: boolean): void {
  console.log('\nStarter spell backfill summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Scanned starter-session rows: ${summary.scanned}`);
  console.log(`  Matched source templates: ${summary.matched}`);
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
    console.error('Usage: bun scripts/backfill-starter-spell-columns.ts [--dry-run|--apply]');
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
    console.error(`Starter spell backfill failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
