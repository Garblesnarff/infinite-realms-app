import { readFileSync } from 'node:fs';
import path from 'node:path';

import { NARRATION_QUESTION_IDS } from './questions';

import type { NarrationQuestionId } from './questions';

export type EngineAction = {
  kind: string;
  count: number;
  hit?: boolean;
  mixed?: boolean;
};

export type EngineContract = {
  currentTurn: { slug: string; isPlayer: boolean; round: number } | null;
  actions: EngineAction[];
  sceneDescription: string | null;
};

export type NarrationFixture = {
  id: string;
  source: string;
  context: string;
  narration: string;
  playerDeclared: string | null;
  engine: EngineContract;
  labels: Record<NarrationQuestionId, boolean>;
};

export type MemoryCandidate = {
  id: string;
  source: string;
  text: string;
  type: string;
  category?: string;
  /** Stored `memories.importance`, when the row came from the table. */
  storedImportance?: number;
  /** Stored `created_at`, used only as the live tie-break. */
  createdAt?: string;
  /** Stored gemini-embedding-001 vector. Absent on the GitHub-quote starter rows. */
  embedding?: number[];
};

export type RerankFixture = {
  id: string;
  source: string;
  playerMessage: string;
  /** RETRIEVAL_QUERY vector for playerMessage. Absent when the row has no stored embedding. */
  queryEmbedding: number[] | null;
  candidates: MemoryCandidate[];
  relevantIds: string[];
};

export type ImportanceFixture = {
  id: string;
  source: string;
  text: string;
  type: string;
  category?: string;
  handImportance: number;
};

function readJsonl(filePath: string): unknown[] {
  const text = readFileSync(filePath, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readEmbedding(value: unknown, label: string): number[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
  ) {
    throw new Error(`${label} embedding must be an array of finite numbers`);
  }
  if (value.length === 0) {
    throw new Error(`${label} embedding is empty`);
  }
  return value;
}

function requireString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Fixture row missing ${key}`);
  }
  return value;
}

export function loadNarrationFixtures(filePath: string): NarrationFixture[] {
  return readJsonl(filePath).map((row) => {
    if (!isRecord(row) || !isRecord(row.labels) || !isRecord(row.engine)) {
      throw new Error('Narration fixture row is not an object');
    }
    const labels = {} as Record<NarrationQuestionId, boolean>;
    for (const id of NARRATION_QUESTION_IDS) {
      const value = row.labels[id];
      if (typeof value !== 'boolean') {
        throw new Error(`Narration ${String(row.id)} missing label ${id}`);
      }
      labels[id] = value;
    }
    const engine = row.engine as EngineContract;
    return {
      id: requireString(row, 'id'),
      source: requireString(row, 'source'),
      context: requireString(row, 'context'),
      narration: requireString(row, 'narration'),
      playerDeclared: typeof row.player_declared === 'string' ? row.player_declared : null,
      engine,
      labels,
    };
  });
}

export function loadPool(filePath: string): Map<string, MemoryCandidate> {
  const pool = new Map<string, MemoryCandidate>();
  for (const row of readJsonl(filePath)) {
    if (!isRecord(row)) {
      throw new Error('Pool row is not an object');
    }
    const candidate: MemoryCandidate = {
      id: requireString(row, 'id'),
      source: requireString(row, 'source'),
      text: requireString(row, 'text'),
      type: requireString(row, 'type'),
      category: typeof row.category === 'string' ? row.category : undefined,
      storedImportance: typeof row.importance === 'number' ? row.importance : undefined,
      createdAt: typeof row.created_at === 'string' ? row.created_at : undefined,
      embedding: readEmbedding(row.embedding, requireString(row, 'id')),
    };
    pool.set(candidate.id, candidate);
  }
  return pool;
}

export function loadRerankFixtures(
  filePath: string,
  pool: Map<string, MemoryCandidate>,
): RerankFixture[] {
  return readJsonl(filePath).map((row) => {
    if (!isRecord(row) || !Array.isArray(row.candidate_ids) || !Array.isArray(row.relevant_ids)) {
      throw new Error('Rerank fixture row is malformed');
    }
    const candidates = row.candidate_ids.map((id) => {
      if (typeof id !== 'string') {
        throw new Error('candidate id is not a string');
      }
      const found = pool.get(id);
      if (!found) {
        throw new Error(`Unknown candidate ${id}`);
      }
      return found;
    });
    if (candidates.length < 10) {
      throw new Error(`Rerank ${String(row.id)} has fewer than 10 candidates`);
    }
    const relevantIds = row.relevant_ids.map((id) => {
      if (typeof id !== 'string' || !candidates.some((candidate) => candidate.id === id)) {
        throw new Error(`Relevant id ${String(id)} is not in the candidate list`);
      }
      return id;
    });
    return {
      id: requireString(row, 'id'),
      source: requireString(row, 'source'),
      playerMessage: requireString(row, 'player_message'),
      queryEmbedding: readEmbedding(row.query_embedding, requireString(row, 'id')) ?? null,
      candidates,
      relevantIds,
    };
  });
}

export function loadImportanceFixtures(filePath: string): ImportanceFixture[] {
  return readJsonl(filePath).map((row) => {
    if (!isRecord(row) || typeof row.hand_importance !== 'number') {
      throw new Error('Importance fixture row is malformed');
    }
    if (row.hand_importance < 1 || row.hand_importance > 5) {
      throw new Error(`hand_importance out of range for ${String(row.id)}`);
    }
    return {
      id: requireString(row, 'id'),
      source: requireString(row, 'source'),
      text: requireString(row, 'text'),
      type: requireString(row, 'type'),
      category: typeof row.category === 'string' ? row.category : undefined,
      handImportance: row.hand_importance,
    };
  });
}

export function fixtureDir(): string {
  return path.join(import.meta.dir, '..', 'fixtures');
}
