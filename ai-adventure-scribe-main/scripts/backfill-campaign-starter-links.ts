#!/usr/bin/env bun
/* eslint-disable max-lines, no-console */
/**
 * Backfill the campaign-level starter link introduced for #1938.
 *
 * A campaign is eligible only when it is currently unlinked and at least one of its
 * sessions has a non-empty starter_campaign_id. If sessions disagree about the link,
 * the campaign is reported and skipped rather than guessed. Existing campaign links
 * are never replaced, which makes a successful apply idempotent.
 *
 * The command is a dry run by default. Dry-run output must be reviewed before a
 * separate `--apply` invocation. Apply reads through the service-role Supabase client
 * and writes through DATABASE_URL; operators must confirm both point at the same
 * database and take a snapshot before applying.
 *
 * Usage:
 *   bun scripts/backfill-campaign-starter-links.ts
 *   DATABASE_URL=postgres://... bun scripts/backfill-campaign-starter-links.ts --apply
 */

import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import postgres from 'postgres';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

type PostgresClient = ReturnType<typeof postgres>;

export interface CampaignStarterLinkRow {
  id: string;
  name: string | null;
  starter_campaign_id: string | null;
}

export interface CampaignSessionStarterLinkRow {
  id: string;
  campaign_id: string | null;
  starter_campaign_id: string | null;
}

export interface CampaignStarterLinkBackfillInput {
  campaigns: CampaignStarterLinkRow[];
  sessions: CampaignSessionStarterLinkRow[];
}

export interface CampaignStarterLinkBackfillPlan {
  campaignId: string;
  campaignName: string;
  previousStarterCampaignId: string | null;
  starterCampaignId: string;
  sourceSessionIds: string[];
  changed: boolean;
}

export interface SkippedCampaignStarterLinkRow {
  campaignId: string;
  campaignName: string;
  reason: string;
}

export interface CampaignStarterLinkBackfillResult {
  plans: CampaignStarterLinkBackfillPlan[];
  skipped: SkippedCampaignStarterLinkRow[];
  alreadyLinked: number;
}

export interface CampaignStarterLinkBackfillSummary {
  scanned: number;
  needingRepair: number;
  alreadyLinked: number;
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

function displayName(campaign: CampaignStarterLinkRow): string {
  return campaign.name?.trim() || campaign.id;
}

function normalizeLink(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/** Build the deterministic repair plan without performing any writes. */
export function planCampaignStarterLinkBackfill(
  input: CampaignStarterLinkBackfillInput,
): CampaignStarterLinkBackfillResult {
  const sessionsByCampaign = new Map<string, Map<string, string[]>>();

  for (const session of input.sessions) {
    if (!session.campaign_id) continue;
    const starterCampaignId = normalizeLink(session.starter_campaign_id);
    if (!starterCampaignId) continue;

    const links = sessionsByCampaign.get(session.campaign_id) || new Map<string, string[]>();
    const sessionIds = links.get(starterCampaignId) || [];
    sessionIds.push(session.id);
    links.set(starterCampaignId, sessionIds);
    sessionsByCampaign.set(session.campaign_id, links);
  }

  const plans: CampaignStarterLinkBackfillPlan[] = [];
  const skipped: SkippedCampaignStarterLinkRow[] = [];
  let alreadyLinked = 0;

  for (const campaign of input.campaigns) {
    const currentStarterCampaignId = normalizeLink(campaign.starter_campaign_id);
    if (currentStarterCampaignId) {
      alreadyLinked += 1;
      continue;
    }

    const links = sessionsByCampaign.get(campaign.id);
    if (!links) continue;

    if (links.size > 1) {
      skipped.push({
        campaignId: campaign.id,
        campaignName: displayName(campaign),
        reason: `sessions disagree about starter_campaign_id: ${[...links.keys()].join(', ')}`,
      });
      continue;
    }

    const [starterCampaignId, sourceSessionIds] = [...links.entries()][0] || [];
    if (!starterCampaignId || !sourceSessionIds) continue;

    plans.push({
      campaignId: campaign.id,
      campaignName: displayName(campaign),
      previousStarterCampaignId: null,
      starterCampaignId,
      sourceSessionIds,
      changed: true,
    });
  }

  return { plans, skipped, alreadyLinked };
}

export function formatCampaignStarterLinkPlan(plan: CampaignStarterLinkBackfillPlan): string {
  return `${plan.campaignName} (${plan.campaignId}): ${
    plan.previousStarterCampaignId || 'NULL'
  } -> ${plan.starterCampaignId} [sessions: ${plan.sourceSessionIds.join(', ')}]`;
}

function formatSkippedRow(row: SkippedCampaignStarterLinkRow): string {
  return `Skipped ${row.campaignName} (${row.campaignId}): ${row.reason}`;
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

/** Apply one plan under a row lock and only while the target is still unlinked. */
async function applyPlanAtomically(
  sql: PostgresClient,
  plan: CampaignStarterLinkBackfillPlan,
): Promise<boolean> {
  let updated = false;
  await sql.begin(async (transaction) => {
    const currentRows = await transaction<
      Array<{ id: string; starter_campaign_id: string | null }>
    >`
      SELECT id, starter_campaign_id
      FROM campaigns
      WHERE id = ${plan.campaignId}
      FOR UPDATE
    `;
    const current = currentRows[0];
    if (!current) throw new Error(`No campaign row found for ${plan.campaignId}.`);

    const currentStarterCampaignId = normalizeLink(current.starter_campaign_id);
    if (currentStarterCampaignId === plan.starterCampaignId) return;
    if (currentStarterCampaignId) {
      throw new Error(
        `Campaign ${plan.campaignId} already links ${currentStarterCampaignId}; refusing to replace it.`,
      );
    }

    const updatedRows = await transaction<Array<{ id: string }>>`
      UPDATE campaigns
      SET starter_campaign_id = ${plan.starterCampaignId},
          updated_at = now()
      WHERE id = ${plan.campaignId}
        AND (starter_campaign_id IS NULL OR btrim(starter_campaign_id) = '')
      RETURNING id
    `;
    if (updatedRows.length !== 1) {
      throw new Error(`Expected one updated campaign row for ${plan.campaignId}.`);
    }
    updated = true;
  });
  return updated;
}

export async function runBackfill(options: {
  dryRun: boolean;
  client: SupabaseClient;
}): Promise<CampaignStarterLinkBackfillSummary> {
  const [campaigns, sessions] = await Promise.all([
    selectRows<CampaignStarterLinkRow>(
      options.client,
      'campaigns',
      'id, name, starter_campaign_id',
    ),
    selectRows<CampaignSessionStarterLinkRow>(
      options.client,
      'game_sessions',
      'id, campaign_id, starter_campaign_id',
    ),
  ]);
  if (campaigns.length === 0) throw new Error('No campaigns found; refusing starter-link repair.');

  const plan = planCampaignStarterLinkBackfill({ campaigns, sessions });
  const summary: CampaignStarterLinkBackfillSummary = {
    scanned: campaigns.length,
    needingRepair: plan.plans.length,
    alreadyLinked: plan.alreadyLinked,
    skipped: plan.skipped.length,
    applied: 0,
    failed: 0,
  };

  console.log('\nCampaign starter-link backfill plan');
  for (const row of plan.plans) {
    console.log(
      `${options.dryRun ? 'Would update' : 'Updating'} ${formatCampaignStarterLinkPlan(row)}`,
    );
  }
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
    for (const row of plan.plans) {
      if (options.dryRun || !sql) continue;
      try {
        if (await applyPlanAtomically(sql, row)) summary.applied += 1;
      } catch (error) {
        summary.failed += 1;
        console.error(`Failed ${row.campaignId}: ${errorMessage(error)}`);
      }
    }
  } finally {
    await sql?.end();
  }

  return summary;
}

function printSummary(summary: CampaignStarterLinkBackfillSummary, dryRun: boolean): void {
  console.log('\nCampaign starter-link backfill summary');
  console.log(`  Mode: ${dryRun ? 'DRY RUN' : 'APPLY'}`);
  console.log(`  Scanned campaigns: ${summary.scanned}`);
  console.log(`  Needing repair: ${summary.needingRepair}`);
  console.log(`  Already linked: ${summary.alreadyLinked}`);
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
    console.error('Usage: bun scripts/backfill-campaign-starter-links.ts [--dry-run|--apply]');
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
    console.error(`Campaign starter-link backfill failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main();
}
