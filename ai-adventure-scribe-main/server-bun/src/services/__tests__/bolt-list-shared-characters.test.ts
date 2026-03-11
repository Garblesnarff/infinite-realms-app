import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CharacterService } from '../character-service.js';
import { db } from '../../../../db/client';
import { characters, characterPermissions } from '../../../../db/schema/index';

// Mock the database client
vi.mock('../../../../db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

describe('CharacterService.listSharedCharacters Optimization', () => {
  const mockUserId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list shared characters with a single joined query', async () => {
    const mockResults = [
      {
        character: {
          id: 'char-1',
          name: 'Hero 1',
          race: 'Elf',
          class: 'Wizard',
          level: 5,
          imageUrl: 'url1',
          avatarUrl: 'avatar1',
          campaignId: 'camp-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        permission: {
          id: 'perm-1',
          characterId: 'char-1',
          userId: mockUserId,
          permissionLevel: 'viewer',
          grantedAt: new Date(),
        },
      },
    ];

    // Setup the chainable mock for db.select().from().innerJoin().where().orderBy()
    const mockWhere = {
      orderBy: vi.fn().mockResolvedValue(mockResults),
    };
    const mockInnerJoin = {
      where: vi.fn().mockReturnValue(mockWhere),
    };
    const mockFrom = {
      innerJoin: vi.fn().mockReturnValue(mockInnerJoin),
    };
    const mockSelect = {
      from: vi.fn().mockReturnValue(mockFrom),
    };

    (db.select as any).mockReturnValue(mockSelect);

    const result = await CharacterService.listSharedCharacters(mockUserId);

    // Verify the result mapping
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ...mockResults[0].character,
      permission: mockResults[0].permission,
    });

    // Verify the query structure
    expect(db.select).toHaveBeenCalled();
    expect(mockSelect.from).toHaveBeenCalledWith(characterPermissions);
    expect(mockFrom.innerJoin).toHaveBeenCalledWith(characters, expect.anything());
    expect(mockInnerJoin.where).toHaveBeenCalled();
    expect(mockWhere.orderBy).toHaveBeenCalled();
  });
});
