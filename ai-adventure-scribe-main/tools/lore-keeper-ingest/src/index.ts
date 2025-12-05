#!/usr/bin/env node
/**
 * Lore Keeper Campaign Ingestion CLI
 *
 * Parses campaign files from the external repo and ingests them into Supabase
 * for use by the Lore Keeper MCP server.
 *
 * Usage:
 *   npm run ingest                      # Ingest all campaigns
 *   npm run ingest -- --campaign foo    # Ingest specific campaign
 *   npm run ingest -- --dry-run         # Preview without database changes
 *   npm run ingest -- --skip-embeddings # Skip embedding generation
 */

import { config } from 'dotenv';
import { Command } from 'commander';
import { join } from 'path';
import { existsSync } from 'fs';

import {
  readCampaignFiles,
  listCampaignDirectories,
  parseOverview,
  extractTagline,
  isCampaignComplete,
} from './parser.js';
import { chunkCampaignFiles } from './chunker.js';
import { initOpenAI, generateEmbeddings, estimateCost } from './embeddings.js';
import {
  initSupabase,
  testConnection,
  upsertStarterCampaign,
  deleteCampaignChunks,
  deleteCampaignRules,
  insertCampaignChunks,
  insertCampaignRules,
  listStarterCampaigns,
} from './database.js';
import type { IngestOptions, IngestResult } from './types.js';

// Load environment variables
config({ path: join(process.cwd(), '.env') });
config({ path: join(process.cwd(), '../../.env') }); // Try parent directories
config({ path: join(process.cwd(), '../../../.env') });

const program = new Command();

program
  .name('lore-keeper-ingest')
  .description('Ingest campaign files into Supabase for Lore Keeper')
  .version('1.0.0')
  .option('-c, --campaign <id>', 'Ingest a specific campaign by directory name')
  .option('-d, --dry-run', 'Preview changes without modifying database', false)
  .option('-v, --verbose', 'Show detailed output', false)
  .option('-s, --skip-embeddings', 'Skip embedding generation', false)
  .option('-p, --repo-path <path>', 'Path to the campaign repo', '../../../infinite-realms-clean')
  .option('-l, --list', 'List all campaigns in repo', false)
  .option('--list-ingested', 'List all ingested campaigns', false)
  .action(main);

program.parse();

async function main(options: {
  campaign?: string;
  dryRun: boolean;
  verbose: boolean;
  skipEmbeddings: boolean;
  repoPath: string;
  list: boolean;
  listIngested: boolean;
}): Promise<void> {
  const opts: IngestOptions = {
    dryRun: options.dryRun,
    verbose: options.verbose,
    campaignId: options.campaign,
    repoPath: options.repoPath,
    skipEmbeddings: options.skipEmbeddings,
  };

  console.log('🏰 Lore Keeper Campaign Ingestion');
  console.log('================================\n');

  // Resolve repo path
  const repoPath = join(process.cwd(), opts.repoPath);
  const campaignsPath = join(repoPath, 'campaign-ideas');

  if (!existsSync(campaignsPath)) {
    console.error(`❌ Campaign repo not found at: ${campaignsPath}`);
    console.error('\nMake sure the infinite-realms-clean repo is cloned and the path is correct.');
    console.error('You can specify a custom path with --repo-path');
    process.exit(1);
  }

  // List campaigns in repo
  if (options.list) {
    console.log('📚 Campaigns in repository:\n');
    const campaigns = listCampaignDirectories(repoPath);
    campaigns.forEach((c, i) => console.log(`  ${i + 1}. ${c}`));
    console.log(`\nTotal: ${campaigns.length} campaigns`);
    return;
  }

  // Initialize services
  if (!opts.dryRun) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Missing environment variables:');
      if (!supabaseUrl) console.error('  - SUPABASE_URL or VITE_SUPABASE_URL');
      if (!supabaseKey) console.error('  - SUPABASE_SERVICE_ROLE_KEY');
      process.exit(1);
    }

    initSupabase(supabaseUrl, supabaseKey);

    // Test connection
    const connected = await testConnection();
    if (!connected) {
      console.error('❌ Failed to connect to Supabase. Check your credentials.');
      process.exit(1);
    }
    console.log('✅ Connected to Supabase\n');
  }

  // List ingested campaigns
  if (options.listIngested) {
    if (opts.dryRun) {
      console.error('❌ Cannot list ingested campaigns in dry-run mode');
      process.exit(1);
    }

    console.log('📚 Ingested campaigns:\n');
    const campaigns = await listStarterCampaigns();
    if (campaigns.length === 0) {
      console.log('  No campaigns ingested yet.');
    } else {
      campaigns.forEach((c, i) => {
        const status = c.isPublished ? '✅ Published' : c.isComplete ? '📝 Complete' : '⏳ Incomplete';
        console.log(`  ${i + 1}. ${c.title} (${c.id}) - ${status}`);
      });
    }
    console.log(`\nTotal: ${campaigns.length} campaigns`);
    return;
  }

  // Initialize OpenAI for embeddings
  if (!opts.skipEmbeddings && !opts.dryRun) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      console.error('❌ Missing OPENAI_API_KEY environment variable');
      console.error('Use --skip-embeddings to skip embedding generation');
      process.exit(1);
    }
    initOpenAI(openaiKey);
    console.log('✅ OpenAI client initialized\n');
  }

  // Get campaigns to ingest
  let campaignIds: string[];
  if (opts.campaignId) {
    campaignIds = [opts.campaignId];
  } else {
    campaignIds = listCampaignDirectories(repoPath);
  }

  console.log(`📋 Campaigns to process: ${campaignIds.length}\n`);

  // Process each campaign
  const results: IngestResult[] = [];

  for (const campaignId of campaignIds) {
    try {
      const result = await ingestCampaign(campaignId, repoPath, opts);
      results.push(result);

      if (result.errors.length > 0) {
        console.log(`⚠️  ${campaignId}: ${result.errors.join(', ')}`);
      } else {
        console.log(`✅ ${campaignId}: ${result.chunksCreated} chunks, ${result.rulesCreated} rules`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ ${campaignId}: ${message}`);
      results.push({
        campaignId,
        title: campaignId,
        chunksCreated: 0,
        rulesCreated: 0,
        embeddingsGenerated: 0,
        errors: [message],
      });
    }
  }

  // Summary
  console.log('\n================================');
  console.log('📊 Ingestion Summary\n');

  const successful = results.filter(r => r.errors.length === 0);
  const failed = results.filter(r => r.errors.length > 0);

  console.log(`  Successful: ${successful.length}`);
  console.log(`  Failed: ${failed.length}`);
  console.log(`  Total chunks: ${results.reduce((sum, r) => sum + r.chunksCreated, 0)}`);
  console.log(`  Total rules: ${results.reduce((sum, r) => sum + r.rulesCreated, 0)}`);
  console.log(`  Total embeddings: ${results.reduce((sum, r) => sum + r.embeddingsGenerated, 0)}`);

  if (opts.dryRun) {
    console.log('\n⚠️  DRY RUN - No changes were made to the database');
  }
}

/**
 * Ingest a single campaign
 */
async function ingestCampaign(
  campaignId: string,
  repoPath: string,
  opts: IngestOptions
): Promise<IngestResult> {
  const campaignPath = join(repoPath, 'campaign-ideas', campaignId);

  if (!existsSync(campaignPath)) {
    return {
      campaignId,
      title: campaignId,
      chunksCreated: 0,
      rulesCreated: 0,
      embeddingsGenerated: 0,
      errors: [`Directory not found: ${campaignPath}`],
    };
  }

  // Read campaign files
  const files = readCampaignFiles(campaignPath);

  if (!files.overview) {
    return {
      campaignId,
      title: campaignId,
      chunksCreated: 0,
      rulesCreated: 0,
      embeddingsGenerated: 0,
      errors: ['Missing overview.md'],
    };
  }

  // Parse campaign metadata
  const campaign = parseOverview(files.overview, campaignId);
  campaign.tagline = extractTagline(files.creativeBrief, files.overview);
  campaign.creativeBrief = files.creativeBrief;
  campaign.overview = files.overview;

  const isComplete = isCampaignComplete(files);

  if (opts.verbose) {
    console.log(`\n  Processing: ${campaign.title}`);
    console.log(`  Complete: ${isComplete ? 'Yes' : 'No'}`);
    console.log(`  Genre: ${campaign.genre.join(', ')}`);
    console.log(`  Difficulty: ${campaign.difficulty}`);
  }

  // Chunk the content
  const { chunks, rules } = chunkCampaignFiles(campaignId, files);

  if (opts.verbose) {
    console.log(`  Chunks: ${chunks.length}`);
    console.log(`  Rules: ${rules.length}`);
  }

  // Estimate embedding cost
  if (!opts.skipEmbeddings && !opts.dryRun) {
    const { tokens, cost } = estimateCost(chunks.map(c => c.content));
    if (opts.verbose) {
      console.log(`  Embedding cost: ~${tokens} tokens (~$${cost.toFixed(4)})`);
    }
  }

  // Dry run - stop here
  if (opts.dryRun) {
    return {
      campaignId,
      title: campaign.title,
      chunksCreated: chunks.length,
      rulesCreated: rules.length,
      embeddingsGenerated: 0,
      errors: [],
    };
  }

  // Upsert campaign
  await upsertStarterCampaign({
    ...campaign,
    isComplete,
    isPublished: false, // Always start unpublished
  });

  // Delete existing chunks and rules
  await deleteCampaignChunks(campaignId);
  await deleteCampaignRules(campaignId);

  // Generate embeddings
  let embeddings: (number[] | null)[] = [];
  if (!opts.skipEmbeddings && chunks.length > 0) {
    const texts = chunks.map(c => c.content);
    embeddings = await generateEmbeddings(texts);
  }

  // Insert chunks and rules
  const chunksCreated = await insertCampaignChunks(chunks, embeddings);
  const rulesCreated = await insertCampaignRules(rules);

  return {
    campaignId,
    title: campaign.title,
    chunksCreated,
    rulesCreated,
    embeddingsGenerated: embeddings.length,
    errors: [],
  };
}
