/* eslint-disable max-lines */

import { isSectionMarkerName, normalizeEntityNameForChunkType } from './entity-name.js';
import {
  campaignChunkIdentity,
  campaignChunkSourceIdentity,
  chunkIdentity,
  chooseReingestSurvivor,
  dedupeCampaignChunks,
  hasImageUrl,
  isReingestableEntityName,
  mergeMetadataPreservingImageUrl,
} from './reingest.js';

import type { ExistingCampaignChunk } from './reingest.js';
import type { CampaignChunk, CampaignRule, ParsedCampaign } from './types.js';
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ReingestResult {
  parsedChunks: number;
  parsedEntities: number;
  rowsWritten: number;
  rowsInserted: number;
  rowsUpdated: number;
  duplicateRowsRemoved: number;
  sectionMarkerRowsRemoved: number;
}

type ChunkUpdatePayload = {
  campaign_id: string;
  chunk_type: string;
  entity_name: string | null;
  parent_entity: string | null;
  content: string;
  summary: string | null;
  metadata: Record<string, unknown>;
  source_file: string;
  source_section: string | null;
  sequence_order: number | null;
  embedding?: string;
};

function formatEmbedding(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function rowIdentity(row: ExistingCampaignChunk): string {
  return (
    campaignChunkIdentity(row.campaign_id, row.chunk_type, row.entity_name) ||
    campaignChunkSourceIdentity(
      row.campaign_id,
      row.chunk_type,
      row.source_file || '',
      row.source_section,
    )
  );
}

function chunkPayload(
  chunk: CampaignChunk,
  metadata: Record<string, unknown>,
  embedding: number[] | null | undefined,
): ChunkUpdatePayload {
  const entityName =
    chunk.entityName == null
      ? null
      : normalizeEntityNameForChunkType(chunk.entityName, chunk.chunkType);

  return {
    campaign_id: chunk.campaignId,
    chunk_type: chunk.chunkType,
    entity_name: entityName,
    parent_entity: chunk.parentEntity || null,
    content: chunk.content,
    summary: chunk.summary || null,
    metadata,
    source_file: chunk.sourceFile,
    source_section: chunk.sourceSection || null,
    sequence_order: chunk.sequenceOrder ?? null,
    ...(embedding ? { embedding: formatEmbedding(embedding) } : {}),
  };
}

function addCandidate(
  candidatesByIdentity: Map<string, ExistingCampaignChunk[]>,
  identity: string,
  row: ExistingCampaignChunk,
): void {
  const candidates = candidatesByIdentity.get(identity) || [];
  candidates.push(row);
  candidatesByIdentity.set(identity, candidates);
}

async function deleteRows(client: SupabaseClient, ids: Set<string>): Promise<void> {
  const rowIds = [...ids];
  for (let index = 0; index < rowIds.length; index += 100) {
    const batch = rowIds.slice(index, index + 100);
    const { error } = await client.from('campaign_chunks').delete().in('id', batch);
    if (error) throw new Error(`Failed to remove stale campaign chunks: ${error.message}`);
  }
}

export async function readExistingCampaignChunks(
  client: SupabaseClient,
  campaignId: string,
): Promise<ExistingCampaignChunk[]> {
  const { data, error } = await client
    .from('campaign_chunks')
    .select(
      'id, campaign_id, chunk_type, entity_name, metadata, source_file, source_section, created_at',
    )
    .eq('campaign_id', campaignId);
  if (error) throw new Error(`Failed to read existing chunks for ${campaignId}: ${error.message}`);

  return (data || []) as ExistingCampaignChunk[];
}

/**
 * Re-ingest one campaign without the destructive delete-first behavior of the
 * original CLI. Legacy formatted names are matched to their clean identity,
 * so asset-bearing rows keep their UUID and image metadata.
 */
export async function reingestCampaignChunks(
  client: SupabaseClient,
  chunks: CampaignChunk[],
  embeddings: (number[] | null)[] = [],
): Promise<ReingestResult> {
  const parsedChunks = dedupeCampaignChunks(chunks);
  const [firstChunk] = parsedChunks;
  if (!firstChunk) {
    return {
      parsedChunks: 0,
      parsedEntities: 0,
      rowsWritten: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      duplicateRowsRemoved: 0,
      sectionMarkerRowsRemoved: 0,
    };
  }

  const campaignId = firstChunk.campaignId;
  if (parsedChunks.some((chunk) => chunk.campaignId !== campaignId)) {
    throw new Error('Re-ingestion accepts chunks for exactly one campaign at a time');
  }

  const existingRows = await readExistingCampaignChunks(client, campaignId);
  const candidatesByIdentity = new Map<string, ExistingCampaignChunk[]>();
  for (const row of existingRows) addCandidate(candidatesByIdentity, rowIdentity(row), row);

  const embeddingByIdentity = new Map<string, number[] | null | undefined>();
  chunks.forEach((chunk, index) =>
    embeddingByIdentity.set(chunkIdentity(chunk), embeddings[index]),
  );

  const usedIds = new Set<string>();
  const rowsToDelete = new Set<string>();
  const sectionMarkerIds = new Set<string>();
  let rowsInserted = 0;
  let rowsUpdated = 0;

  for (const chunk of parsedChunks) {
    if (!isReingestableEntityName(chunk.entityName)) {
      throw new Error(`Parser emitted section marker "${chunk.entityName}" for ${campaignId}`);
    }

    const normalizedEntityName =
      chunk.entityName == null
        ? null
        : normalizeEntityNameForChunkType(chunk.entityName, chunk.chunkType);
    const identity =
      campaignChunkIdentity(campaignId, chunk.chunkType, normalizedEntityName) ||
      campaignChunkSourceIdentity(
        campaignId,
        chunk.chunkType,
        chunk.sourceFile,
        chunk.sourceSection,
      );
    const candidates = (candidatesByIdentity.get(identity) || []).filter(
      (candidate) => !rowsToDelete.has(candidate.id),
    );
    const embedding = embeddingByIdentity.get(chunkIdentity(chunk));

    let mergedMetadata: Record<string, unknown> = {};
    for (const candidate of candidates.sort(
      (left, right) => Number(hasImageUrl(right.metadata)) - Number(hasImageUrl(left.metadata)),
    )) {
      mergedMetadata = mergeMetadataPreservingImageUrl(mergedMetadata, candidate.metadata);
    }
    mergedMetadata = mergeMetadataPreservingImageUrl(mergedMetadata, chunk.metadata);

    if (candidates.length > 0) {
      const survivor = chooseReingestSurvivor(candidates, normalizedEntityName);
      const payload = chunkPayload(chunk, mergedMetadata, embedding);
      const { error: updateError } = await client
        .from('campaign_chunks')
        .update(payload)
        .eq('id', survivor.id);
      if (updateError) {
        throw new Error(
          `Failed to update ${campaignId}/${normalizedEntityName}: ${updateError.message}`,
        );
      }

      usedIds.add(survivor.id);
      rowsUpdated += 1;
      for (const candidate of candidates) {
        if (candidate.id !== survivor.id) rowsToDelete.add(candidate.id);
      }
    } else {
      const { error: insertError } = await client
        .from('campaign_chunks')
        .insert(chunkPayload(chunk, mergedMetadata, embedding));
      if (insertError) {
        throw new Error(
          `Failed to insert ${campaignId}/${normalizedEntityName}: ${insertError.message}`,
        );
      }
      rowsInserted += 1;
    }
  }

  for (const row of existingRows) {
    if (
      row.entity_name &&
      isSectionMarkerName(row.entity_name) &&
      !usedIds.has(row.id) &&
      !rowsToDelete.has(row.id)
    ) {
      if (hasImageUrl(row.metadata)) {
        throw new Error(
          `Refusing to delete asset-linked section marker ${campaignId}/${row.entity_name}`,
        );
      }
      rowsToDelete.add(row.id);
      sectionMarkerIds.add(row.id);
    }
  }

  await deleteRows(client, rowsToDelete);

  const result: ReingestResult = {
    parsedChunks: parsedChunks.length,
    parsedEntities: parsedChunks.filter((chunk) => chunk.entityName != null).length,
    rowsWritten: rowsInserted + rowsUpdated,
    rowsInserted,
    rowsUpdated,
    duplicateRowsRemoved: rowsToDelete.size - sectionMarkerIds.size,
    sectionMarkerRowsRemoved: sectionMarkerIds.size,
  };

  if (result.rowsWritten !== result.parsedChunks) {
    throw new Error(
      `Re-ingestion count mismatch for ${campaignId}: parsed ${result.parsedChunks}, wrote ${result.rowsWritten}`,
    );
  }

  return result;
}

export async function upsertStarterCampaignPreservingState(
  client: SupabaseClient,
  campaign: ParsedCampaign & { isComplete: boolean },
): Promise<void> {
  const payload = {
    slug: campaign.slug,
    title: campaign.title,
    tagline: campaign.tagline,
    genre: campaign.genre,
    sub_genre: campaign.subGenre,
    tone: campaign.tone,
    difficulty: campaign.difficulty,
    level_range: campaign.levelRange,
    estimated_sessions: campaign.estimatedSessions,
    premise: campaign.premise,
    creative_brief: campaign.creativeBrief,
    overview: campaign.overview,
    is_complete: campaign.isComplete,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: readError } = await client
    .from('starter_campaigns')
    .select('id')
    .eq('id', campaign.id)
    .maybeSingle();
  if (readError) throw new Error(`Failed to read campaign ${campaign.id}: ${readError.message}`);

  if (existing) {
    const { error } = await client.from('starter_campaigns').update(payload).eq('id', campaign.id);
    if (error) throw new Error(`Failed to update campaign ${campaign.id}: ${error.message}`);
    return;
  }

  const { error } = await client
    .from('starter_campaigns')
    .insert({ id: campaign.id, ...payload, is_published: false });
  if (error) throw new Error(`Failed to insert campaign ${campaign.id}: ${error.message}`);
}

export async function replaceCampaignRules(
  client: SupabaseClient,
  campaignId: string,
  rules: CampaignRule[],
): Promise<void> {
  const { error: deleteError } = await client
    .from('campaign_rules')
    .delete()
    .eq('campaign_id', campaignId);
  if (deleteError)
    throw new Error(`Failed to replace rules for ${campaignId}: ${deleteError.message}`);

  if (rules.length === 0) return;

  const { error: insertError } = await client.from('campaign_rules').insert(
    rules.map((rule) => ({
      campaign_id: rule.campaignId,
      rule_type: rule.ruleType,
      condition: rule.condition,
      effect: rule.effect,
      reversible: rule.reversible,
      priority: rule.priority,
      metadata: rule.metadata,
    })),
  );
  if (insertError)
    throw new Error(`Failed to insert rules for ${campaignId}: ${insertError.message}`);
}
