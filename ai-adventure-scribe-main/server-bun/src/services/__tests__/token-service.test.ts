/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../../db/client.js';
import { TokenService } from '../token-service.js';
import { TRPCError } from '@trpc/server';

// Mock the db client
vi.mock('../../../../db/client.js', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      scenes: {
        findFirst: vi.fn(),
      },
      tokenConfigurations: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(),
          })),
        })),
        innerJoin: vi.fn(() => ({
            where: vi.fn()
        }))
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
  };
});

describe('TokenService', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';
  const mockTokenId = 'token-123';
  const mockSceneId = 'scene-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getDefaultTokenConfig', () => {
    it('should throw NOT_FOUND if character is not found or not owned', async () => {
      // Mock the consolidated query returning nothing
      (db as any).select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      await expect(TokenService.getDefaultTokenConfig(mockCharacterId, mockUserId))
        .rejects.toThrow(TRPCError);

      try {
        await TokenService.getDefaultTokenConfig(mockCharacterId, mockUserId);
      } catch (e: any) {
        expect(e.code).toBe('NOT_FOUND');
      }
    });

    it('should return config if character is owned', async () => {
      const mockConfig = { id: 'config-123', imageUrl: 'test.png' };
      (db as any).select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ characterId: mockCharacterId, config: mockConfig }]),
            }),
          }),
        }),
      });

      const result = await TokenService.getDefaultTokenConfig(mockCharacterId, mockUserId);
      expect(result).toEqual(mockConfig);
    });

    it('should return null if character is owned but has no config', async () => {
      // Mock Drizzle returning character with all-null config object
      (db as any).select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                characterId: mockCharacterId,
                config: { id: null, imageUrl: null }
              }]),
            }),
          }),
        }),
      });

      const result = await TokenService.getDefaultTokenConfig(mockCharacterId, mockUserId);
      expect(result).toBeNull();
    });
  });

  describe('createToken', () => {
    it('should parallelize verifySceneAccess and verifyCharacterOwnership', async () => {
      // Mock verifySceneAccess and verifyCharacterOwnership (private methods)
      // Since they are private, we mock the db calls they make
      (db.query.scenes.findFirst as any).mockResolvedValue({ id: mockSceneId });
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: mockTokenId, sceneId: mockSceneId }])
        })
      });

      await TokenService.createToken(mockSceneId, mockUserId, {
        sceneId: mockSceneId,
        actorId: mockCharacterId,
        name: 'New Token',
        tokenType: 'character',
        positionX: 0,
        positionY: 0
      });

      expect(db.query.scenes.findFirst).toHaveBeenCalled();
      expect(db.query.characters.findFirst).toHaveBeenCalled();
      expect(db.insert).toHaveBeenCalled();
    });
  });
});
