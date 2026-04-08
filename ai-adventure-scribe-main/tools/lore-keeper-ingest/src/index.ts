#!/usr/bin/env node
/**
 * Lore Keeper Campaign Ingestion CLI
 *
 * Parses campaign files from the external repo and ingests them into Supabase
 * for use by the Lore Keeper MCP server.
 *
 * Usage:
 *   bun run ingest                      # Ingest all campaigns
 *   bun run ingest -- --campaign foo    # Ingest specific campaign
 *   bun run ingest -- --dry-run         # Preview without database changes
 *   bun run ingest -- --skip-embeddings # Skip embedding generation
 */

import { existsSync } from 'fs';
import { join } from 'path';

import { Command } from 'commander';
import { config } from 'dotenv';

import { chunkCampaignFiles } from './chunker.js';
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
import { initOpenAI, generateEmbeddings, estimateCost } from './embeddings.js';
import {
  readCampaignFiles,
  listCampaignDirectories,
  parseOverview,
  extractTagline,
  isCampaignComplete,
} from './parser.js';

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

  // Initialize Gemini for embeddings
  if (!opts.skipEmbeddings && !opts.dryRun) {
    const googleApiKey = process.env.GOOGLE_AI_API_KEY ||
                         process.env.VITE_GOOGLE_GEMINI_API_KEY ||
                         process.env.VITE_GEMINI_API_KEYS?.split(',')[0];
    if (!googleApiKey) {
      console.error('❌ Missing GOOGLE_AI_API_KEY or VITE_GOOGLE_GEMINI_API_KEY environment variable');
      console.error('Use --skip-embeddings to skip embedding generation');
      process.exit(1);
    }
    initOpenAI(googleApiKey); // Uses legacy alias for Gemini
    console.log('✅ Gemini embedding client initialized\n');
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
  console.log(`  Failed:     ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n  Errors:');
    failed.forEach(f => {
      console.log(`    - ${f.campaignId}: ${f.errors.join(', ')}`);
    });
  }

  console.log(`\n  Total chunks: ${results.reduce((sum, r) => sum + r.chunksCreated, 0)}`);
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
  const dirName = campaignId.split('/').pop() || '';

  // Validate required files per spec
  const missingFiles: string[] = [];
  if (!files.creativeBrief) {
    missingFiles.push('creative-brief.md');
  }
  if (!files.worldBuildingSpec) {
    missingFiles.push('world-building-spec.md');
  }
  if (!files.campaignBible) {
    missingFiles.push(`${dirName}-campaign-bible.md`);
  }
  if (!files.overview) {
    missingFiles.push(`${dirName}.md`);
  }

  if (missingFiles.length > 0) {
    return {
      campaignId,
      title: campaignId,
      chunksCreated: 0,
      rulesCreated: 0,
      embeddingsGenerated: 0,
      errors: [`missing ${missingFiles.join(', ')}`],
    };
  }

  // Parse campaign metadata
  let campaign, chunks, rules;
  try {
    campaign = parseOverview(files.overview!, campaignId);
    campaign.tagline = extractTagline(files.creativeBrief, files.overview);
    campaign.creativeBrief = files.creativeBrief;
    campaign.overview = files.overview;

    const chunkResult = chunkCampaignFiles(campaignId, files);
    chunks = chunkResult.chunks;
    rules = chunkResult.rules;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parsing error';
    return {
      campaignId,
      title: campaignId,
      chunksCreated: 0,
      rulesCreated: 0,
      embeddingsGenerated: 0,
      errors: [`Malformed markdown: ${message}`],
    };
  }


  const isComplete = isCampaignComplete(files);

  if (opts.verbose) {
    console.log(`\n  Processing: ${campaign.title}`);
    console.log(`  Complete: ${isComplete ? 'Yes' : 'No'}`);
    console.log(`  Genre: ${campaign.genre.join(', ')}`);
    console.log(`  Difficulty: ${campaign.difficulty}`);
  }

  if (opts.verbose) {
    console.log(`  Chunks: ${chunks.length}`);
    console.log(`  Rules: ${rules.length}`);
  }

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

  // Generate embeddings
  let embeddings: (number[] | null)[] = [];
  let embeddingsGenerated = 0;
  if (!opts.skipEmbeddings && chunks.length > 0) {
    try {
      const texts = chunks.map(c => c.content);
      embeddings = await generateEmbeddings(texts);
      embeddingsGenerated = embeddings.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown embedding error';
      return {
        campaignId,
        title: campaign.title,
        chunksCreated: 0,
        rulesCreated: 0,
        embeddingsGenerated: 0,
        errors: [`Embedding generation error: ${message}`],
      };
    }
  }

  // Database operations
  let chunksCreated = 0;
  let rulesCreated = 0;

  try {
    // Upsert campaign
    await upsertStarterCampaign({
      ...campaign,
      isComplete,
      isPublished: false, // Always start unpublished
    });

    // Delete existing chunks and rules
    await deleteCampaignChunks(campaignId);
    await deleteCampaignRules(campaignId);

    // Insert chunks and rules
    chunksCreated = await insertCampaignChunks(chunks, embeddings);
    rulesCreated = await insertCampaignRules(rules);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown database error';
    return {
      campaignId,
      title: campaign.title,
      chunksCreated: 0,
      rulesCreated: 0,
      embeddingsGenerated: 0,
      errors: [`Database error: ${message}`],
    };
  }

  return {
    campaignId,
    title: campaign.title,
    chunksCreated,
    rulesCreated,
    embeddingsGenerated,
    errors: [],
  };
}
