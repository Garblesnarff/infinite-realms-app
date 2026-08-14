import type { ChunkType } from './types.js';

/**
 * Remove the formatting wrappers that are part of a bible list entry rather
 * than part of the entity's canonical name.
 */
export function normalizeEntityName(name: string): string {
  let normalized = name.trim();

  while (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
    normalized = normalized.slice(1, -1).trim();
  }

  return normalized;
}

/**
 * Normalize the prefixes used by the campaign-bible dialects supported by the
 * chunker. The cleanup is deliberately scoped to the chunk type that owns the
 * formatting convention.
 */
export function normalizeEntityNameForChunkType(
  name: string,
  chunkType: ChunkType | string,
): string {
  let normalized = normalizeEntityName(name);

  if (chunkType === 'location') {
    normalized = normalized.replace(/^Loc\s+\d+:\s*/i, '');
  }

  normalized = normalized.replace(/:\s*$/, '');

  if (chunkType === 'faction') {
    normalized = normalized.replace(/^\d+\.\s*/, '');
  }

  return normalized.trim();
}

/**
 * Names matching these values are parser structure, not canonical entities.
 */
export function isSectionMarkerName(name: string): boolean {
  const normalized = normalizeEntityName(name).replace(/:\s*$/, '').trim();
  return /^TAG:\s*/i.test(normalized) || /^(?:Concept|History)$/i.test(normalized);
}
