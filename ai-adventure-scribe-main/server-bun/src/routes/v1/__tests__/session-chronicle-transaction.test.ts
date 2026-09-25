import { mock } from 'bun:test';
import { describe, expect, it, vi } from 'vitest';

// chronicle-generator now imports AIUsageService, which loads server-bun db/env
// at module init. This file only needs the pure status writer.
Object.assign(process.env, {
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  PORT: '3000',
  CORS_ORIGIN: 'http://localhost:3000',
  WORKOS_API_KEY: 'test-workos-key',
  WORKOS_CLIENT_ID: 'test-workos-client',
});

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
