/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CharacterService } from '../character-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(() => ({
      values: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      returning: vi.fn(),
    })),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    exists: vi.fn(),
    inArray: vi.fn(),
    desc: vi.fn(),
    isNotNull: vi.fn(),
    sql: vi.fn((strings, ...values) => ({ strings, values })),
  };
});

describe('CharacterService.saveCharacterSpells', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock for select builder
    const createMockSelect = () => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      unionAll: vi.fn().mockImplementation(() => createMockSelect()),
      then: vi.fn((cb) => Promise.resolve(cb([]))),
      // Add support for async/await
      [Symbol.iterator]: function* () { yield Promise.resolve([]); },
    });

    (db.select as any).mockImplementation(createMockSelect);

    // Make db.select also a thenable for direct await
    const mockSelect = (db.select as any);
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      unionAll: vi.fn().mockReturnThis(),
      then: (onFullfilled: any) => Promise.resolve([]).then(onFullfilled),
    });
  });

  it('should throw NotFoundError if character is not found or not owned by user', async () => {
    // 1. Class lookup mock (must succeed for validation to reach ownership check)
    const mockClassSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (onFullfilled: any) => Promise.resolve([{ id: 'class-123' }]).then(onFullfilled),
    };
    (db.select as any).mockReturnValueOnce(mockClassSelect);

    // 2. Delete mock returns empty array (no rows affected)
    (db.delete as any).mockReturnValue({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([])
    });

    // 3. Ownership check fallback returns null
    (db.query.characters.findFirst as any).mockResolvedValue(null);

    await expect(CharacterService.saveCharacterSpells(mockCharacterId, mockUserId, [], 'Wizard'))
      .rejects.toThrow(NotFoundError);
  });

  it('should call delete and insert if character is owned', async () => {
    // 1. Ownership check
    (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId, userId: mockUserId });

    // 2. Class lookup mock
    const mockClassSelect = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      then: (onFullfilled: any) => Promise.resolve([{ id: 'class-123' }]).then(onFullfilled),
    };

    // 2.5. Valid class spells check mock
    const mockValidSpellsSelect = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (onFullfilled: any) => Promise.resolve([{ spellId: 'spell-1', spellName: 'Magic Missile' }]).then(onFullfilled),
    };

    // 3. Spells lookup mock (for consistency check at the end)
    const mockSpellsSelect = {
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      then: (onFullfilled: any) => Promise.resolve([
        { name: 'Fireball', level: 3 },
        { name: 'Light', level: 0 }
      ]).then(onFullfilled),
    };

    (db.select as any)
      .mockReturnValueOnce(mockClassSelect) // For class lookup
      .mockReturnValueOnce(mockValidSpellsSelect) // For validation
      .mockReturnValueOnce(mockSpellsSelect); // For sync fetch

    // 4. Delete mock
    (db.delete as any).mockReturnValue({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'deleted-123' }])
    });

    // 5. Insert mock
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'log-123' }])
    });

    // 6. Update mock (called by updateSpells)
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: mockCharacterId }])
    });

    const result = await CharacterService.saveCharacterSpells(mockCharacterId, mockUserId, ['spell-1'], 'Wizard');

    expect(result.success).toBe(true);
    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled(); // Consistency sync
  });
});
