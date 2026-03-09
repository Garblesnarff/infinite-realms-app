import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../../db/client';
import { CombatInitiativeService } from '../combat-initiative-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    execute: vi.fn(),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    sql: vi.fn((strings, ...values) => ({
      strings,
      values,
    })),
  };
});

describe('CombatInitiativeService.calculateTurnOrder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call db.execute with the correct SQL query', async () => {
    const encounterId = 'test-encounter-id';

    await CombatInitiativeService.calculateTurnOrder(encounterId);

    expect(db.execute).toHaveBeenCalledTimes(1);

    const call = vi.mocked(db.execute).mock.calls[0][0] as any;

    // Check if it's the right query
    const queryText = call.strings.join('?');
    expect(queryText).toContain('WITH sorted_participants AS');
    expect(queryText).toContain('ROW_NUMBER() OVER (ORDER BY initiative DESC, initiative_modifier DESC)');
    expect(queryText).toContain('UPDATE combat_participants');

    // Check if the encounterId was passed correctly
    expect(call.values).toContain(encounterId);
  });
});
