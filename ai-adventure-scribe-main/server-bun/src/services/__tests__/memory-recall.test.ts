import { describe, expect, it } from 'bun:test';

import {
  mergeRecall,
  recallWithBudget,
  rescueOverlapCandidates,
  resetRecallRateLimit,
  shouldRunMatch,
  takeRecallSlot,
} from '../memory-recall';

describe('memory recall merge', () => {
  it('puts a similar NPC memory ahead of an unrelated high-importance row, with no duplicates', () => {
    const merged = mergeRecall(
      [{ id: 'reeves', content: 'Captain Reeves keeps the line' }],
      [
        { id: 'unrelated', content: 'A feast in another hall', importance: 10 },
        { id: 'reeves', content: 'Captain Reeves keeps the line', importance: 3 },
      ],
      8,
    );
    expect(merged.map((row) => row.id)).toEqual(['reeves', 'unrelated']);
    expect(new Set(merged.map((row) => row.id)).size).toBe(merged.length);
  });

  it('keeps the caller limit', () => {
    const similar = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const important = [{ id: 'd' }, { id: 'e' }, { id: 'f' }];
    expect(mergeRecall(similar, important, 4)).toHaveLength(4);
  });

  it('falls back to top-by-importance when embedding does not return, and does not throw', async () => {
    const logs: unknown[] = [];
    const started = Date.now();
    const result = await recallWithBudget({
      limit: 2,
      budgetMs: 40,
      loadImportant: async () => [{ id: 'high' }, { id: 'next' }],
      loadSimilar: () => new Promise<Array<{ id: string }>>(() => {}),
      logFallback: (error) => logs.push(error),
    });
    expect(result.fellBack).toBe(true);
    expect(result.rows.map((row) => row.id)).toEqual(['high', 'next']);
    expect(logs).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(300);
  });

  it('stops embedding after 30 calls in a minute', () => {
    resetRecallRateLimit();
    for (let i = 0; i < 30; i += 1) {
      expect(takeRecallSlot('user-1', 1_000)).toBe(true);
    }
    expect(takeRecallSlot('user-1', 1_000)).toBe(false);
    expect(takeRecallSlot('user-1', 61_000)).toBe(true);
  });

  it('does not start a match once the budget is spent', () => {
    expect(shouldRunMatch(1_000, 300, 1_200)).toBe(true);
    expect(shouldRunMatch(1_000, 300, 1_300)).toBe(false);
  });

  it('falls back when the embedding call rejects', async () => {
    const result = await recallWithBudget({
      limit: 2,
      loadImportant: async () => [{ id: 'high' }],
      loadSimilar: async () => {
        throw new Error('embedding down');
      },
    });
    expect(result.fellBack).toBe(true);
    expect(result.rows).toEqual([{ id: 'high' }]);
  });
});

describe('memory recall candidate rescue (#353)', () => {
  const NOW = Date.parse('2026-10-21T00:00:00Z');
  const tile = {
    id: 'tile',
    content: 'There is a cracked blue tile by the east door of the kitchen.',
    importance: 5,
    createdAt: '2026-10-20T00:00:00Z',
  };
  const filler = (id: string, importance: number): { id: string; content: string; importance: number; createdAt: string } => ({
    id,
    content: `The apprentice helped in the kitchen: chore ${id}.`,
    importance,
    createdAt: '2026-10-20T00:00:00Z',
  });

  it('rescues a crowded-out fact that shares topical words with the query', () => {
    const merged = [filler('a', 9), filler('b', 8), filler('c', 6), filler('d', 6)];
    const pool = [...merged, tile];
    const result = rescueOverlapCandidates(merged, pool, 'What was strange about the floor by the east door?', 4, undefined, NOW);
    expect(result).toHaveLength(4);
    expect(result.map((r) => r.id)).toContain('tile');
    // The lowest-priority zero-overlap row is the one displaced.
    expect(result.map((r) => r.id)).not.toContain('d');
  });

  it('never displaces a protected similarity pick', () => {
    const sim = { id: 'sim', content: 'A feast in another hall entirely.', importance: 3, createdAt: '2026-10-20T00:00:00Z' };
    const merged = [sim, filler('b', 8)];
    const pool = [...merged, tile];
    const result = rescueOverlapCandidates(merged, pool, 'What was strange about the floor by the east door?', 2, new Set(['sim']), NOW);
    expect(result.map((r) => r.id)).toEqual(['sim', 'tile']);
  });

  it('does not displace a merged row that itself overlaps the query', () => {
    const summary = {
      id: 'summary',
      content: 'The apprentice noted the east door draft and the dinner service.',
      importance: 9,
      createdAt: '2026-10-20T00:00:00Z',
    };
    const merged = [summary, filler('b', 8)];
    const pool = [...merged, tile];
    const result = rescueOverlapCandidates(merged, pool, 'What was strange about the floor by the east door?', 2, undefined, NOW);
    // Only filler b is displaceable; the summary overlaps (east, door) and stays.
    expect(result.map((r) => r.id)).toEqual(['summary', 'tile']);
  });

  it('rescues on a single rare token, but not on a single common one', () => {
    const item = {
      id: 'item',
      content: 'Quillon gave the apprentice a brass thimble etched with a heron.',
      importance: 7,
      createdAt: '2026-10-20T00:00:00Z',
    };
    const merged = [filler('a', 9), filler('b', 8)];
    const rare = rescueOverlapCandidates(merged, [...merged, item], 'Who ended up with the heron?', 2, undefined, NOW);
    expect(rare.map((r) => r.id)).toContain('item');

    // 'kitchen' is in five pool rows here, so a row matching only on it is
    // not rescued: a common word is not a pointer.
    const crowded = [filler('a', 9), filler('b', 8), filler('c', 7), filler('d', 6)];
    const hall = {
      id: 'hall',
      content: 'The kitchen in the other hall is cold and quiet.',
      importance: 5,
      createdAt: '2026-10-20T00:00:00Z',
    };
    const common = rescueOverlapCandidates(crowded, [...crowded, hall], 'What happened in the kitchen?', 4, undefined, NOW);
    expect(common.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('caps the swaps so a topical query cannot evict the whole set', () => {
    const merged = [filler('a', 9), filler('b', 8), filler('c', 7), filler('d', 6)];
    const extras = ['east', 'door', 'tile'].map((word, i) => ({
      id: `extra-${word}`,
      content: `A note about the ${word} and the east door by the tile stack ${i}.`,
      importance: 5,
      createdAt: '2026-10-20T00:00:00Z',
    }));
    const result = rescueOverlapCandidates(merged, [...merged, ...extras], 'Tell me about the east door tile', 4, undefined, NOW);
    const swappedIn = result.filter((r) => r.id.startsWith('extra-'));
    expect(swappedIn.length).toBe(2);
    expect(result).toHaveLength(4);
  });

  it('appends a qualifying candidate when the merged set is under the limit', () => {
    const merged = [filler('a', 9)];
    const result = rescueOverlapCandidates(merged, [...merged, tile], 'What was strange about the floor by the east door?', 4, undefined, NOW);
    expect(result.map((r) => r.id)).toEqual(['a', 'tile']);
  });

  it('is a no-op when no pool row qualifies', () => {
    const merged = [filler('a', 9), filler('b', 8)];
    const result = rescueOverlapCandidates(merged, [...merged], 'What was strange about the floor by the east door?', 2, undefined, NOW);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
