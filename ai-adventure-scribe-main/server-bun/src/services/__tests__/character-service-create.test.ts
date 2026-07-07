import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../../../db/client';
import { CharacterService } from '../character-service.js';

vi.mock('../../../../db/client', () => ({
  db: {
    transaction: vi.fn(),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({})) })) })),
    query: { characters: { findFirst: vi.fn() } },
  },
}));

describe('CharacterService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates the character, stats, and equipment in one transaction', async () => {
    const insert = vi.fn();
    insert
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'character-1', name: 'Aria' }]),
        }),
      })
      .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) })
      .mockReturnValueOnce({ values: vi.fn().mockResolvedValue(undefined) });

    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback) =>
      callback({ insert }),
    );

    const result = await CharacterService.create(
      'user-1',
      { name: 'Aria', campaignId: 'campaign-1' },
      { strength: 14 },
      [{ item_name: 'Longsword', quantity: 1 }],
    );

    expect(result).toEqual({ id: 'character-1', name: 'Aria' });
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(insert).toHaveBeenCalledTimes(3);
  });

  it('rejects the whole operation when stats persistence fails', async () => {
    const insert = vi.fn();
    insert
      .mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'character-1', name: 'Aria' }]),
        }),
      })
      .mockReturnValueOnce({ values: vi.fn().mockRejectedValue(new Error('stats failed')) });

    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback) =>
      callback({ insert }),
    );

    await expect(
      CharacterService.create('user-1', { name: 'Aria' }, { strength: 14 }),
    ).rejects.toThrow('stats failed');
  });

  it('does not return a character that is outside the authenticated user scope', async () => {
    (db.query.characters.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await expect(CharacterService.getById('character-for-user-b', 'user-a')).resolves.toBeNull();
    expect(db.query.characters.findFirst).toHaveBeenCalledOnce();
  });
});
