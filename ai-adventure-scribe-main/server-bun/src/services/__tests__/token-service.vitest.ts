/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from '@trpc/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { TokenService } from '../token-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => {
  const mockDb = {
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
      characterTokens: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  };

  const createQueryBuilderMock = (): any => {
    const mock: any = {
      from: vi.fn(() => mock),
      innerJoin: vi.fn(() => mock),
      leftJoin: vi.fn(() => mock),
      where: vi.fn(() => mock),
      orderBy: vi.fn(() => mock),
      limit: vi.fn(() => mock),
      returning: vi.fn(() => mock),
      values: vi.fn(() => mock),
      set: vi.fn(() => mock),
      select: vi.fn(() => mock),
    };
    // Make it thenable for easy awaiting if needed, or just mock the final method
    return mock;
  };

  mockDb.select.mockImplementation(() => createQueryBuilderMock());
  mockDb.insert.mockImplementation(() => createQueryBuilderMock());
  mockDb.update.mockImplementation(() => createQueryBuilderMock());
  mockDb.delete.mockImplementation(() => createQueryBuilderMock());

  return { db: mockDb };
});

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
    desc: vi.fn((col) => ({ type: 'desc', col })),
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
      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

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
      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([{ characterId: mockCharacterId, config: mockConfig }]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

      const result = await TokenService.getDefaultTokenConfig(mockCharacterId, mockUserId);
      expect(result).toEqual(mockConfig);
    });

    it('should return null if character is owned but has no config', async () => {
      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([{
        characterId: mockCharacterId,
        config: { id: null, imageUrl: null }
      }]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

      const result = await TokenService.getDefaultTokenConfig(mockCharacterId, mockUserId);
      expect(result).toBeNull();
    });
  });

  describe('createToken', () => {
    it('should use atomic INSERT ... SELECT for ownership verification', async () => {
      const mockOwnershipBuilder = (db as any).select();
      mockOwnershipBuilder.limit.mockResolvedValue([{ one: 1 }]);
      (db as any).select.mockReturnValue(mockOwnershipBuilder);

      const mockInsertBuilder = (db as any).insert();
      mockInsertBuilder.values.mockReturnValue(mockInsertBuilder);
      mockInsertBuilder.returning.mockResolvedValue([{ id: mockTokenId, sceneId: mockSceneId }]);
      (db as any).insert.mockReturnValue(mockInsertBuilder);

      const result = await TokenService.createToken(mockSceneId, mockUserId, {
        sceneId: mockSceneId,
        actorId: mockCharacterId,
        name: 'New Token',
        tokenType: 'character',
        positionX: 0,
        positionY: 0
      });

      expect(db.insert).toHaveBeenCalled();
      expect(db.select).toHaveBeenCalled();
      expect(mockInsertBuilder.values).toHaveBeenCalled();
      expect(result).toEqual({ id: mockTokenId, sceneId: mockSceneId });
    });

    it('should throw NOT_FOUND if insertion fails (unauthorized or missing)', async () => {
      const mockOwnershipBuilder = (db as any).select();
      mockOwnershipBuilder.limit.mockResolvedValue([]);
      (db as any).select.mockReturnValue(mockOwnershipBuilder);

      await expect(TokenService.createToken(mockSceneId, mockUserId, {
        sceneId: mockSceneId,
        actorId: mockCharacterId,
        name: 'New Token',
        tokenType: 'character',
        positionX: 0,
        positionY: 0
      })).rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });
  });

  describe('applyDefaultConfig', () => {
    it('should correctly consolidate queries and apply config', async () => {
      const mockConfig = { id: 'config-123', imageUrl: 'test.png' };
      const mockToken = { id: mockTokenId, actorId: mockCharacterId, sceneId: mockSceneId };
      const mockCharacter = { id: mockCharacterId, userId: mockUserId };

      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([{
        token: mockToken,
        character: mockCharacter,
        config: mockConfig
      }]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

      const mockUpdateBuilder = (db as any).update();
      mockUpdateBuilder.set.mockReturnValue(mockUpdateBuilder);
      mockUpdateBuilder.where.mockReturnValue(mockUpdateBuilder);
      mockUpdateBuilder.returning.mockResolvedValue([mockToken]);
      (db as any).update.mockReturnValue(mockUpdateBuilder);

      const result = await TokenService.applyDefaultConfig(mockTokenId, mockUserId);

      expect(db.select).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(result).toEqual(mockToken);
    });

    it('should return null if token is not found or scene not owned', async () => {
      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

      const result = await TokenService.applyDefaultConfig(mockTokenId, mockUserId);
      expect(result).toBeNull();
    });

    it('should throw BAD_REQUEST if token has no actorId', async () => {
      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([{
        token: { id: mockTokenId, actorId: null },
        character: null,
        config: null
      }]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

      await expect(TokenService.applyDefaultConfig(mockTokenId, mockUserId))
        .rejects.toThrow(expect.objectContaining({ code: 'BAD_REQUEST' }));
    });

    it('should throw NOT_FOUND if character is not owned', async () => {
      const mockQueryBuilder = (db as any).select();
      mockQueryBuilder.limit.mockResolvedValue([{
        token: { id: mockTokenId, actorId: mockCharacterId },
        character: { id: mockCharacterId, userId: 'other-user' },
        config: null
      }]);
      (db as any).select.mockReturnValue(mockQueryBuilder);

      await expect(TokenService.applyDefaultConfig(mockTokenId, mockUserId))
        .rejects.toThrow(expect.objectContaining({ code: 'NOT_FOUND' }));
    });
  });
});
