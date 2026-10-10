#!/usr/bin/env bun
/* eslint-disable no-console */
/**
 * Safely re-ingest the four starter campaign bibles after the parser fix.
 *
 * Dry-run is the default. The Hetzner operator must pass --apply explicitly.
 * This script never uses the destructive delete-first ingestion path; existing
 * campaign_chunks rows are matched by their cleaned identity and keep any
 * existing metadata.image_url values.
 *
 * Example:
 *   bun scripts/reingest-starter-campaigns.ts --repo-path /var/www/infiniterealms/infinite-realms-clean
 *   bun scripts/reingest-starter-campaigns.ts --repo-path /var/www/infiniterealms/infinite-realms-clean --apply
 */

import { join, resolve } from 'node:path';

import { config } from 'dotenv';

import { chunkCampaignFiles } from '../tools/lore-keeper-ingest/src/chunker.ts';
import {
  estimateCost,
  generateEmbeddings,
  initGemini,
} from '../tools/lore-keeper-ingest/src/embeddings.ts';
import {
  extractTagline,
  isCampaignComplete,
  parseOverview,
  readCampaignFiles,
} from '../tools/lore-keeper-ingest/src/parser.ts';
import {
  reingestCampaignChunks,
  replaceCampaignRules,
  upsertStarterCampaignPreservingState,
} from '../tools/lore-keeper-ingest/src/reingest-database.ts';
import { isReingestableEntityName } from '../tools/lore-keeper-ingest/src/reingest.ts';

import type {
  CampaignChunk,
  CampaignRule,
  ParsedCampaign,
} from '../tools/lore-keeper-ingest/src/types.ts';

config();
config({ path: join(process.cwd(), 'server-bun/.env') });

const STARTER_CAMPAIGNS = [
  {
    id: 'abyssal-descent',
    relativePath: 'Completed/Horror/abyssal-descent',
  },
  {
    id: 'academy-of-arcane-gastronomy',
    relativePath: 'Completed/Fantasy/academy-of-arcane-gastronomy',
  },
  {
    id: 'the-eternal-feast',
    relativePath: 'Completed/Intrigue/the-eternal-feast',
  },
  {
    id: 'a-midsummer-nights-chaos',
    relativePath: 'Completed/Fantasy/a-midsummer-nights-chaos',
  },
] as const;

interface LoadedCampaign {
  campaign: ParsedCampaign & { isComplete: boolean };
  chunks: CampaignChunk[];
  rules: CampaignRule[];
}

function loadCampaign(repoPath: string, campaignId: string, relativePath: string): LoadedCampaign {
  const campaignPath = join(repoPath, 'campaign-ideas', relativePath);
  const files = readCampaignFiles(campaignPath);
  if (!files.overview || !files.campaignBible) {
    throw new Error(`Missing overview or campaign bible for ${campaignId}: ${campaignPath}`);
  }

  const campaign = parseOverview(files.overview, campaignId);
  campaign.tagline = extractTagline(files.creativeBrief, files.overview);
  campaign.creativeBrief = files.creativeBrief;
  campaign.overview = files.overview;

  const { chunks, rules } = chunkCampaignFiles(campaignId, files);
  const invalidMarkers = chunks.filter((chunk) => !isReingestableEntityName(chunk.entityName));
  if (invalidMarkers.length > 0) {
    throw new Error(
      `Parser emitted section markers for ${campaignId}: ${invalidMarkers
        .map((chunk) => chunk.entityName)
        .join(', ')}`,
    );
  }

  return { campaign: { ...campaign, isComplete: isCampaignComplete(files) }, chunks, rules };
}

interface Options {
  repoPath?: string;
  apply: boolean;
  skipEmbeddings: boolean;
  verbose: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { apply: false, skipEmbeddings: false, verbose: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--skip-embeddings') {
      options.skipEmbeddings = true;
    } else if (argument === '--verbose' || argument === '-v') {
      options.verbose = true;
    } else if (argument === '--repo-path' || argument === '-r') {
      const repoPath = argv[index + 1];
      if (!repoPath) throw new Error(`${argument} requires a path`);
      options.repoPath = repoPath;
      index += 1;
    } else if (argument.startsWith('--repo-path=')) {
      options.repoPath = argument.slice('--repo-path='.length);
      if (!options.repoPath) throw new Error('--repo-path requires a path');
    } else if (argument === '--help' || argument === '-h') {
      console.log(
        'Usage: bun scripts/reingest-starter-campaigns.ts --repo-path <path> [--apply] [--skip-embeddings] [--verbose]',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

async function main(options: Options): Promise<void> {
  if (!options.repoPath) {
    throw new Error('Pass --repo-path pointing at the external infinite-realms-clean repository');
  }

  const repoPath = resolve(options.repoPath);
  const loadedCampaigns = STARTER_CAMPAIGNS.map(({ id, relativePath }) =>
    loadCampaign(repoPath, id, relativePath),
  );

  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'}: ${repoPath}`);
  for (const { campaign, chunks, rules } of loadedCampaigns) {
    const { tokens } = estimateCost(chunks.map((chunk) => chunk.content));
    console.log(
      `${campaign.id}: ${chunks.length} chunks (${chunks.filter((chunk) => chunk.entityName).length} entities), ${rules.length} rules, ~${tokens} embedding tokens`,
    );
  }

  if (!options.apply) {
    console.log('No database changes made. Pass --apply on Hetzner after reviewing this output.');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('A Supabase URL and service-role credential are required for --apply');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (!options.skipEmbeddings) {
    const googleApiKey =
      process.env.GOOGLE_AI_API_KEY ||
      process.env.VITE_GOOGLE_GEMINI_API_KEY ||
      process.env.VITE_GEMINI_API_KEYS?.split(',')[0];
    if (!googleApiKey)
      throw new Error('A Google AI embedding key is required unless --skip-embeddings is set');
    initGemini(googleApiKey);
  }

  for (const { campaign, chunks, rules } of loadedCampaigns) {
    const embeddings = options.skipEmbeddings
      ? []
      : await generateEmbeddings(chunks.map((chunk) => chunk.content));
    if (!options.skipEmbeddings && embeddings.length !== chunks.length) {
      throw new Error(`Embedding count mismatch for ${campaign.id}`);
    }

    await upsertStarterCampaignPreservingState(client, campaign);
    const result = await reingestCampaignChunks(client, chunks, embeddings);
    await replaceCampaignRules(client, campaign.id, rules);

    console.log(
      `${campaign.id}: wrote ${result.rowsWritten}/${result.parsedChunks}, inserted ${result.rowsInserted}, updated ${result.rowsUpdated}, removed ${result.duplicateRowsRemoved} duplicates and ${result.sectionMarkerRowsRemoved} section markers`,
    );
    if (options.verbose) console.log(JSON.stringify(result, null, 2));
  }
}

main(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
