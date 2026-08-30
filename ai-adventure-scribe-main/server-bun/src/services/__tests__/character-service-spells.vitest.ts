/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { CharacterSpellService } from '../character/character-spell-service.js';

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
    ...(actual as any),
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

describe('CharacterSpellService.saveCharacterSpells', () => {
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
      [Symbol.iterator]: function* () {
        yield Promise.resolve([]);
      },
    });

    (db.select as any).mockImplementation(createMockSelect);

    // Make db.select also a thenable for direct await
    const mockSelect = db.select as any;
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

  it('uses fill-if-empty SQL expressions for the post-create legacy-column sync', async () => {
    const set = vi.fn().mockReturnThis();
    (db.update as any).mockReturnValue({
      set,
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: mockCharacterId }]),
    });

    await CharacterSpellService.updateSpells(
      mockCharacterId,
      mockUserId,
      {
        knownSpells: ['new-known'],
        preparedSpells: ['new-prepared'],
      },
      { fillEmptyOnly: true },
    );

    const updates = set.mock.calls[0]?.[0] as Record<string, unknown>;
    for (const column of ['knownSpells', 'preparedSpells']) {
      const expression = updates[column] as { strings: string[]; values: unknown[] };
      expect(expression.strings.join(' ')).toContain('IS NULL');
      expect(expression.strings.join(' ')).toContain('ELSE');
      expect(expression.values).toContain(column === 'knownSpells' ? 'new-known' : 'new-prepared');
    }
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
      returning: vi.fn().mockResolvedValue([]),
    });

    // 3. Ownership check fallback returns null
    (db.query.characters.findFirst as any).mockResolvedValue(null);

    await expect(
      CharacterSpellService.saveCharacterSpells(mockCharacterId, mockUserId, [], 'Wizard'),
    ).rejects.toThrow(NotFoundError);
  });

  it('should call delete and insert if character is owned', async () => {
    // 1. Ownership check
    (db.query.characters.findFirst as any).mockResolvedValue({
      id: mockCharacterId,
      userId: mockUserId,
    });

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
      then: (onFullfilled: any) =>
        Promise.resolve([{ spellId: 'spell-1', spellName: 'Magic Missile' }]).then(onFullfilled),
    };

    // The insert used to be an insert-select carrying the ownership check in its
    // subquery -- and, projecting 5 of character_spells' 10 columns, Drizzle
    // rejected it, so this write never ran. It is now an explicit ownership query
    // plus a class_spells lookup plus a plain insert.
    //
    // Those two extra statements cannot be positioned with mockReturnValueOnce: the
    // surrounding DELETE and ownership clauses build nested exists() subqueries, each
    // of which is its own db.select call, so the call index of any given statement is
    // not stable. Only the first two calls are deterministic; everything after falls
    // through to a permissive default whose single row satisfies both readers
    // (`editable` wants any row, `grantable` reads `.spellId`).
    const permissiveSelect = () => ({
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      then: (onFulfilled: any) =>
        Promise.resolve([{ one: 1, spellId: 'spell-1' }]).then(onFulfilled),
    });

    (db.select as any)
      .mockImplementation(permissiveSelect)
      .mockReturnValueOnce(mockClassSelect) // For class lookup
      .mockReturnValueOnce(mockValidSpellsSelect); // For validation

    // 4. Delete mock
    (db.delete as any).mockReturnValue({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'deleted-123' }]),
    });

    // 5. Insert mock
    (db.insert as any).mockReturnValue({
      values: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 'log-123' }]),
    });

    // 6. Update mock (called by updateSpells)
    (db.update as any).mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: mockCharacterId }]),
    });

    const result = await CharacterSpellService.saveCharacterSpells(
      mockCharacterId,
      mockUserId,
      ['spell-1'],
      'Wizard',
    );

    expect(result.success).toBe(true);
    expect(db.delete).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled(); // Consistency sync
  });
});
