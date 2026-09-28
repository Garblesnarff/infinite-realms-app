import { describe, expect, it } from 'bun:test';

import { mergeRecall, recallWithBudget, resetRecallRateLimit, shouldRunMatch, takeRecallSlot } from '../memory-recall';

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
