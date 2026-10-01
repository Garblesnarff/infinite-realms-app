import { isSectionMarkerName, normalizeEntityNameForChunkType } from './entity-name.js';

import type { CampaignChunk } from './types.js';

export interface ExistingCampaignChunk {
  id: string;
  campaign_id: string;
  chunk_type: string;
  entity_name: string | null;
  metadata: Record<string, unknown> | null;
  source_file: string | null;
  source_section: string | null;
  created_at: string;
}

export interface ReingestDiffSummary {
  entitiesAdded: number;
  entitiesRenamed: number;
  entitiesUnchanged: number;
  imageUrlRowsPreserved: number;
}

export function hasImageUrl(metadata: Record<string, unknown> | null | undefined): boolean {
  const value = metadata?.image_url;
  return typeof value === 'string' && value.length > 0;
}

/**
 * Merge fresh parser metadata without allowing a re-ingest to erase an asset
 * URL already attached to the canonical row.
 */
export function mergeMetadataPreservingImageUrl(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const merged = { ...(existing || {}), ...(incoming || {}) };
  const existingImageUrl = existing?.image_url;
  if (typeof existingImageUrl === 'string' && existingImageUrl.length > 0) {
    merged.image_url = existingImageUrl;
  }
  return merged;
}

export function campaignChunkIdentity(
  campaignId: string,
  chunkType: string,
  entityName: string | null | undefined,
): string | null {
  if (entityName == null) return null;

  const normalizedName = normalizeEntityNameForChunkType(entityName, chunkType);
  return `${campaignId}\u0000${chunkType}\u0000${normalizedName}`;
}

export function campaignChunkSourceIdentity(
  campaignId: string,
  chunkType: string,
  sourceFile: string,
  sourceSection: string | null | undefined,
): string {
  return `${campaignId}\u0000${chunkType}\u0000${sourceFile}\u0000${sourceSection || ''}`;
}

export function chunkIdentity(chunk: CampaignChunk): string {
  return (
    campaignChunkIdentity(chunk.campaignId, chunk.chunkType, chunk.entityName) ||
    campaignChunkSourceIdentity(
      chunk.campaignId,
      chunk.chunkType,
      chunk.sourceFile,
      chunk.sourceSection,
    )
  );
}

/**
 * Prevent a single run from asking Postgres to update the same unique key
 * twice. This also makes the rows-written assertion meaningful.
 */
export function dedupeCampaignChunks(chunks: CampaignChunk[]): CampaignChunk[] {
  const byIdentity = new Map<string, CampaignChunk>();

  for (const chunk of chunks) {
    const identity = chunkIdentity(chunk);
    const existing = byIdentity.get(identity);
    if (!existing || (!hasImageUrl(existing.metadata) && hasImageUrl(chunk.metadata))) {
      byIdentity.set(identity, chunk);
    }
  }

  return [...byIdentity.values()];
}

function existingChunkIdentity(row: ExistingCampaignChunk): string {
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

export function chooseReingestSurvivor(
  candidates: ExistingCampaignChunk[],
  normalizedEntityName: string | null,
): ExistingCampaignChunk {
  const ranked = [...candidates].sort((left, right) => {
    const imageRank = Number(hasImageUrl(right.metadata)) - Number(hasImageUrl(left.metadata));
    if (imageRank !== 0) return imageRank;

    const exactRank =
      Number(right.entity_name === normalizedEntityName) -
      Number(left.entity_name === normalizedEntityName);
    if (exactRank !== 0) return exactRank;

    return Date.parse(right.created_at || '') - Date.parse(left.created_at || '');
  });

  const [survivor] = ranked;
  if (!survivor) throw new Error('Expected at least one campaign chunk candidate');
  return survivor;
}

/**
 * Compare parsed entities with the rows that a safe re-ingest would match.
 * This is read-only and deliberately uses the same identity normalization and
 * survivor ranking as the apply path.
 */
export function summarizeReingestDiff(
  chunks: CampaignChunk[],
  existingRows: ExistingCampaignChunk[],
): ReingestDiffSummary {
  const candidatesByIdentity = new Map<string, ExistingCampaignChunk[]>();
  for (const row of existingRows) {
    const identity = existingChunkIdentity(row);
    const candidates = candidatesByIdentity.get(identity) || [];
    candidates.push(row);
    candidatesByIdentity.set(identity, candidates);
  }

  const summary: ReingestDiffSummary = {
    entitiesAdded: 0,
    entitiesRenamed: 0,
    entitiesUnchanged: 0,
    imageUrlRowsPreserved: 0,
  };

  for (const chunk of dedupeCampaignChunks(chunks)) {
    if (chunk.entityName == null) continue;
    if (!isReingestableEntityName(chunk.entityName)) {
      throw new Error(`Parser emitted section marker "${chunk.entityName}"`);
    }

    const normalizedEntityName = normalizeEntityNameForChunkType(chunk.entityName, chunk.chunkType);
    const identity = campaignChunkIdentity(chunk.campaignId, chunk.chunkType, normalizedEntityName);
    if (!identity) continue;

    const candidates = candidatesByIdentity.get(identity) || [];
    if (candidates.length === 0) {
      summary.entitiesAdded += 1;
      continue;
    }

    const survivor = chooseReingestSurvivor(candidates, normalizedEntityName);
    if (survivor.entity_name === normalizedEntityName) {
      summary.entitiesUnchanged += 1;
    } else {
      summary.entitiesRenamed += 1;
    }
    if (hasImageUrl(survivor.metadata)) summary.imageUrlRowsPreserved += 1;
  }

  return summary;
}

export interface StaleRow {
  id: string;
  chunkType: string;
  entityName: string | null;
  hasImageUrl: boolean;
  /** Plain `--apply` deletes it: an unused section marker (apply throws on one with an image_url). */
  removedByApply: boolean;
  /** Plain `--apply` throws on it: an unused section marker that has an image_url. */
  refusedByApply: boolean;
  /** `--apply --remove-stale` deletes it: no image_url, and plain apply leaves it. */
  removedByRemoveStale: boolean;
}

/**
 * List the existing rows that no parsed chunk matches. Uses the same identity
 * as the apply path, so a row listed here is one apply never updates. Read-only.
 */
export function listStaleRows(
  chunks: CampaignChunk[],
  existingRows: ExistingCampaignChunk[],
): StaleRow[] {
  const parsedIdentities = new Set(dedupeCampaignChunks(chunks).map(chunkIdentity));

  return existingRows
    .filter((row) => !parsedIdentities.has(existingChunkIdentity(row)))
    .map((row) => {
      const imageLinked = hasImageUrl(row.metadata);
      const sectionMarker = row.entity_name != null && isSectionMarkerName(row.entity_name);
      return {
        id: row.id,
        chunkType: row.chunk_type,
        entityName: row.entity_name,
        hasImageUrl: imageLinked,
        removedByApply: sectionMarker && !imageLinked,
        refusedByApply: sectionMarker && imageLinked,
        removedByRemoveStale: !sectionMarker && !imageLinked,
      };
    });
}

export function isReingestableEntityName(entityName: string | null | undefined): boolean {
  return entityName == null || !isSectionMarkerName(entityName);
}
