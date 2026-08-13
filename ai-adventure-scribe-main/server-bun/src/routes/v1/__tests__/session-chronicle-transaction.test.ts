import { mock } from 'bun:test';
import { describe, expect, it, vi } from 'vitest';

mock.module('../../../../../db/client', () => ({ db: {} }));

const { persistChronicleFailure } = await import('../../../services/chronicle-generator.js');

describe('chronicle status transaction', () => {
  it('persists failed status when generation throws', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    const update = vi.fn().mockReturnValue({ set });
    const transaction = vi.fn(async (callback) => callback({ update }));
    await persistChronicleFailure(
      { transaction } as never,
      'chronicle-1',
      new Error('provider timeout'),
    );
    expect(transaction).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', errorMessage: 'provider timeout' }),
    );
  });
});
