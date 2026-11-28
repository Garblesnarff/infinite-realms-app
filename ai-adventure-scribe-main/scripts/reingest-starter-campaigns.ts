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
 *   bun scripts/reingest-starter-campaigns.ts --repo-path ../infinite-realms
 *   bun scripts/reingest-starter-campaigns.ts --repo-path ../infinite-realms --apply
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { config } from 'dotenv';

import { getOpenRouterModelCandidates } from '../server-bun/src/services/llm-model-config.ts';
import { getModelPricing } from '../server-bun/src/services/model-pricing.ts';
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
  diffPlaceKeys,
  readStoryMapPlaceKeys,
  replaceStoryMap,
  upsertStarterCampaignPreservingState,
} from '../tools/lore-keeper-ingest/src/reingest-database.ts';
import { isReingestableEntityName } from '../tools/lore-keeper-ingest/src/reingest.ts';
import {
  buildStoryMap,
  placesAndZones,
  proposeRoutes,
  readApprovedRoutesFile,
  routesFileJson,
  storyMapReportLine,
  type ChatCompletion,
  type StoryMap,
} from '../tools/lore-keeper-ingest/src/story-map.ts';

import type {
  CampaignChunk,
  CampaignRule,
  ParsedCampaign,
  StoryMapRoute,
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
  campaignPath: string;
  bible: string;
  /** Routes from the bible's `## Routes` section; null when it has none. */
  bibleRoutes: StoryMapRoute[] | null;
  /** Routes from an approved routes.json beside the bible; read only when the bible has none. */
  approvedRoutes: StoryMapRoute[] | null;
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

  const { chunks, rules, routes: bibleRoutes } = chunkCampaignFiles(campaignId, files);
  const invalidMarkers = chunks.filter((chunk) => !isReingestableEntityName(chunk.entityName));
  if (invalidMarkers.length > 0) {
    throw new Error(
      `Parser emitted section markers for ${campaignId}: ${invalidMarkers
        .map((chunk) => chunk.entityName)
        .join(', ')}`,
    );
  }

  return {
    campaign: { ...campaign, isComplete: isCampaignComplete(files) },
    chunks,
    rules,
    campaignPath,
    bible: files.campaignBible,
    bibleRoutes,
    approvedRoutes: bibleRoutes ? null : readApprovedRoutesFile(campaignPath),
  };
}

interface Options {
  repoPath?: string;
  apply: boolean;
  proposeRoutes: boolean;
  skipEmbeddings: boolean;
  verbose: boolean;
}

function parseOptions(argv: string[]): Options {
  const options: Options = {
    apply: false,
    proposeRoutes: false,
    skipEmbeddings: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      options.apply = true;
    } else if (argument === '--propose-routes') {
      options.proposeRoutes = true;
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
        'Usage: bun scripts/reingest-starter-campaigns.ts --repo-path <path> [--apply | --propose-routes] [--skip-embeddings] [--verbose]',
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
    throw new Error('Pass --repo-path pointing at the infinite-realms content submodule');
  }

  const repoPath = resolve(options.repoPath);
  // A missing bible folder for one campaign must not fail the other three:
  // report it clearly and continue with the campaigns that did load.
  const loadedCampaigns: LoadedCampaign[] = [];
  for (const { id, relativePath } of STARTER_CAMPAIGNS) {
    try {
      loadedCampaigns.push(loadCampaign(repoPath, id, relativePath));
    } catch (error) {
      console.error(
        `SKIP ${id}: bible folder missing or unreadable at ${join(repoPath, 'campaign-ideas', relativePath)} — ${error instanceof Error ? error.message : error}`,
      );
    }
  }
  if (loadedCampaigns.length === 0) {
    throw new Error('No starter campaign bibles loaded; nothing to do.');
  }

  if (options.proposeRoutes) {
    await proposeRoutesForCampaigns(loadedCampaigns);
    return;
  }

  // A route that names an unknown place fails the whole run here, before any write (#1752).
  const storyMaps = new Map<string, StoryMap>(
    loadedCampaigns.map((loaded) => [
      loaded.campaign.id,
      buildStoryMap(loaded.campaign.id, loaded.chunks, loaded.bibleRoutes, loaded.approvedRoutes),
    ]),
  );

  console.log(`${options.apply ? 'APPLY' : 'DRY RUN'}: ${repoPath}`);
  for (const { campaign, chunks, rules } of loadedCampaigns) {
    const { tokens } = estimateCost(chunks.map((chunk) => chunk.content));
    console.log(
      `${campaign.id}: ${chunks.length} chunks (${chunks.filter((chunk) => chunk.entityName).length} entities), ${rules.length} rules, ~${tokens} embedding tokens`,
    );
    console.log(storyMapReportLine(storyMaps.get(campaign.id)!));
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!options.apply) {
    // #1752 follow-up: the dry run also names the place keys a re-ingest would rename, read-only,
    // when database credentials are present. Without them it says it could not compare.
    if (supabaseUrl && serviceRoleKey) {
      const { createClient } = await import('@supabase/supabase-js');
      const readClient = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      for (const { campaign } of loadedCampaigns) {
        const map = storyMaps.get(campaign.id)!;
        const { removedKeys, addedKeys } = diffPlaceKeys(
          await readStoryMapPlaceKeys(readClient, campaign.id),
          map,
        );
        console.log(placeKeyChangeLine(campaign.id, removedKeys, addedKeys));
      }
    } else {
      console.log(
        'Place key changes: not compared (no Supabase URL and service-role credential in this run).',
      );
    }
    console.log('No database changes made. Pass --apply on Hetzner after reviewing this output.');
    return;
  }

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
    const mapResult = await replaceStoryMap(client, storyMaps.get(campaign.id)!);
    console.log(
      `${campaign.id}: story map wrote ${mapResult.placesWritten} places and ${mapResult.edgesWritten} route rows`,
    );
    console.log(placeKeyChangeLine(campaign.id, mapResult.removedKeys, mapResult.addedKeys));

    console.log(
      `${campaign.id}: wrote ${result.rowsWritten}/${result.parsedChunks}, inserted ${result.rowsInserted}, updated ${result.rowsUpdated}, removed ${result.duplicateRowsRemoved} duplicates and ${result.sectionMarkerRowsRemoved} section markers`,
    );
    if (options.verbose) console.log(JSON.stringify(result, null, 2));
  }
}

/**
 * One report line for place keys that change on re-ingest. A removed key drops that place's
 * map progress in player campaigns, so the dry run and the apply both print it.
 */
function placeKeyChangeLine(
  campaignId: string,
  removedKeys: string[],
  addedKeys: string[],
): string {
  if (removedKeys.length === 0 && addedKeys.length === 0) {
    return `${campaignId}: place keys unchanged`;
  }
  return `${campaignId}: place keys removed: ${removedKeys.join(', ') || 'none'}; added: ${addedKeys.join(', ') || 'none'}`;
}

/** One OpenRouter chat call. Asks for usage accounting so the reply carries its own cost. */
const openRouterCompletion: ChatCompletion = async ({ model, system, user }) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is required for --propose-routes');
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      usage: { include: true },
    }),
  });
  if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  return {
    text: body.choices?.[0]?.message?.content ?? '',
    inputTokens: body.usage?.prompt_tokens ?? 0,
    outputTokens: body.usage?.completion_tokens ?? 0,
    ...(typeof body.usage?.cost === 'number' ? { costUsd: body.usage.cost } : {}),
  };
};

/**
 * --propose-routes (#1752): one model call per campaign whose bible has no `## Routes` section.
 * Writes routes.proposed.json beside the bible for a person to check and rename to routes.json.
 * Ingest never reads the proposed file. No database access.
 */
async function proposeRoutesForCampaigns(loadedCampaigns: LoadedCampaign[]): Promise<void> {
  const model = getOpenRouterModelCandidates()[0];
  for (const loaded of loadedCampaigns) {
    if (loaded.bibleRoutes) {
      console.log(`${loaded.campaign.id}: the bible has a ## Routes section; nothing to propose`);
      continue;
    }
    const placeNames = placesAndZones(loaded.chunks).places.map((place) => place.name);
    const result = await proposeRoutes(
      loaded.bible,
      placeNames,
      model,
      openRouterCompletion,
      getModelPricing(model),
    );
    const path = join(loaded.campaignPath, 'routes.proposed.json');
    writeFileSync(path, routesFileJson(result.routes));
    const cost =
      result.costUsd == null
        ? 'cost unknown (no price for this model)'
        : `$${result.costUsd.toFixed(5)}`;
    console.log(
      `${loaded.campaign.id}: proposed ${result.routes.length} routes with ${result.model} (${result.inputTokens} input + ${result.outputTokens} output tokens, ${cost}) -> ${path}`,
    );
  }
  console.log(
    'Check each routes.proposed.json, then rename it to routes.json. Ingest reads only routes.json.',
  );
}

main(parseOptions(process.argv.slice(2))).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
