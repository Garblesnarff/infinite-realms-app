import path from 'node:path';

import { describe, expect, it } from 'bun:test';

import { main, parseArgs } from './cli';
import { JEV_MODEL } from './decisions-types';
import {
  loadImportanceFixtures,
  loadNarrationFixtures,
  loadPool,
  loadRerankFixtures,
} from './fixtures';
import { calculateImportance, importanceToFive } from './importance-baseline';
import {
  addNoul,
  agreement,
  catchRate,
  compareImportance,
  emptyRuleScore,
  falseFlagsPer20Clean,
  rankByImportance,
  recallAt5,
} from './metrics';
import { noulDecision, scoreToFive } from './questions';
import { loadRegexChecker } from './regex-checker';
import { narrationRequest } from './requests';
import { scoreRerankBaselines } from './run-experiments';
import { cosineSimilarity, rankBySimilarity } from './similarity';

const fixtures = path.join(import.meta.dir, '..', 'fixtures');
const appRoot = path.join(import.meta.dir, '..', '..', '..');

describe('starter fixtures', () => {
  it('has at least 20 hand-labelled narration, rerank, and importance rows', () => {
    const narration = loadNarrationFixtures(path.join(fixtures, 'narration.jsonl'));
    const pool = loadPool(path.join(fixtures, 'memory-pool.jsonl'));
    const rerank = loadRerankFixtures(path.join(fixtures, 'memory-rerank.jsonl'), pool);
    const importance = loadImportanceFixtures(path.join(fixtures, 'importance.jsonl'));
    expect(narration.length).toBeGreaterThanOrEqual(20);
    expect(rerank.length).toBeGreaterThanOrEqual(20);
    expect(importance.length).toBeGreaterThanOrEqual(20);
    for (const row of rerank) {
      expect(row.candidates.length).toBeGreaterThanOrEqual(10);
      expect(row.relevantIds.length).toBeGreaterThan(0);
    }
  });

  it('builds a decisions request, not a chat request, for a narration', () => {
    const [first] = loadNarrationFixtures(path.join(fixtures, 'narration.jsonl'));
    const request = narrationRequest(first);
    expect(request.model).toBe(JEV_MODEL);
    expect(Object.keys(request.questions)).toContain('unresolved_action');
    expect(Object.keys(request.questions)).toContain('speaks_for_the_player');
    expect(JSON.stringify(request).includes('chat/completions')).toBe(false);
  });

  it('does not find the #2249 checker on this ref', async () => {
    expect(await loadRegexChecker(appRoot)).toBeNull();
  });
});

describe('scoring', () => {
  it('treats noul 0.5 as abstain and maps score levels onto 1-5', () => {
    expect(noulDecision(0.5)).toBeNull();
    expect(noulDecision(0.51)).toBe(true);
    expect(noulDecision(0.49)).toBe(false);
    expect(scoreToFive(0)).toBe(1);
    expect(scoreToFive(3.6)).toBe(5);
    const score = emptyRuleScore();
    addNoul(score, true, 0.9);
    addNoul(score, false, 0.95);
    addNoul(score, true, 0.5);
    expect(catchRate(score)).toBe(0.5);
    expect(falseFlagsPer20Clean(score)).toBe(20);
    expect(score.abstain).toBe(1);
  });

  it('uses the stored importance column, then created_at, when the row has them', () => {
    const ranked = rankByImportance([
      {
        id: 'formula',
        source: 'test',
        text: 'A Very Long Quest Name That Includes Danger And A Mission',
        type: 'plot',
        category: 'player_action',
      },
      {
        id: 'newer',
        source: 'test',
        text: 'x',
        type: 'event',
        storedImportance: 10,
        createdAt: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 'older',
        source: 'test',
        text: 'y',
        type: 'event',
        storedImportance: 10,
        createdAt: '2020-01-01T00:00:00.000Z',
      },
    ]);
    expect(ranked).toEqual(['newer', 'older', 'formula']);
  });

  it('ranks stored embeddings by cosine similarity, the same direction as match_memories', () => {
    const query = [1, 0];
    const candidates = [
      { id: 'far', source: 'test', text: 'far', type: 'event', embedding: [0, 1] },
      { id: 'near', source: 'test', text: 'near', type: 'event', embedding: [1, 0] },
      { id: 'mid', source: 'test', text: 'mid', type: 'event', embedding: [0.6, 0.8] },
    ];
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(rankBySimilarity(query, candidates)).toEqual(['near', 'mid', 'far']);
    expect(rankBySimilarity(null, candidates)).toBeNull();
    expect(rankBySimilarity(query, [{ ...candidates[0], embedding: undefined }])).toBeNull();
  });

  it('reports importance and similarity separately, and does not invent vectors', () => {
    const pool = loadPool(path.join(fixtures, 'memory-pool.jsonl'));
    const rerank = loadRerankFixtures(path.join(fixtures, 'memory-rerank.jsonl'), pool);
    const baselines = scoreRerankBaselines(rerank);
    expect(baselines.importanceRecall).not.toBeNull();
    expect(baselines.similarityRows).toBe(0);
    expect(baselines.similarityRecall).toBeNull();
    const withVectors = scoreRerankBaselines([
      {
        ...rerank[0],
        queryEmbedding: [1, 0],
        candidates: rerank[0].candidates.map((candidate, index) => ({
          ...candidate,
          embedding: index < 5 ? [1, 0] : [0, 1],
        })),
        relevantIds: rerank[0].candidates.slice(0, 2).map((candidate) => candidate.id),
      },
    ]);
    expect(withVectors.similarityRows).toBe(1);
    expect(withVectors.similarityRecall).toBe(1);
  });

  it('recall@5 beats a raw order when the relevant rows are sorted first', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    expect(recallAt5(ids, ['a', 'j'])).toBe(0.5);
    expect(recallAt5(['j', 'a', 'b', 'c', 'd'], ['a', 'j'])).toBe(1);
  });

  it('bins calculateImportance onto 1-5', () => {
    expect(importanceToFive(1)).toBe(1);
    expect(importanceToFive(2)).toBe(1);
    expect(importanceToFive(10)).toBe(5);
    expect(calculateImportance({ content: '', type: 'unknown' })).toBe(1);
  });

  it('compares the importance baseline to hand labels without calling Jev', () => {
    const rows = loadImportanceFixtures(path.join(fixtures, 'importance.jsonl')).map((row) =>
      compareImportance(row, null, undefined),
    );
    const rate = agreement(rows, 'baseline');
    expect(rate).not.toBeNull();
    expect(rate as number).toBeGreaterThanOrEqual(0);
    expect(rate as number).toBeLessThanOrEqual(1);
    expect(agreement(rows, 'jev')).toBeNull();
  });
});

describe('cli', () => {
  it('parses a dry run', () => {
    expect(parseArgs(['--dry-run', '--experiment', 'A']).dryRun).toBe(true);
    expect(parseArgs(['--experiment', 'B']).experiment).toBe('B');
  });

  it('dry-run prints the estimate and does not require a key', async () => {
    const lines: string[] = [];
    const original = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const code = await main(['--dry-run'], {});
      expect(code).toBe(0);
    } finally {
      process.stdout.write = original;
    }
    const text = lines.join('');
    expect(text.includes('dry-run: no request was sent.')).toBe(true);
    expect(text.includes('under_cap=true')).toBe(true);
    expect(text.includes('requests=57')).toBe(true);
    expect(text.includes('sk-or-')).toBe(false);
  });

  it('refuses a live run when the key is missing', async () => {
    const code = await main(['--experiment', 'A'], {});
    expect(code).toBe(2);
  });
});
