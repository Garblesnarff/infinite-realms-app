/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { FogOfWarService } from '../fog-of-war-service.js';

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
      fogOfWar: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const createQueryBuilderMock = (): any => {
    const mock: any = {
      from: vi.fn(() => mock),
      innerJoin: vi.fn(() => mock),
      leftJoin: vi.fn(() => mock),
      where: vi.fn(() => mock),
      limit: vi.fn(() => mock),
      returning: vi.fn(() => mock),
      values: vi.fn(() => mock),
      select: vi.fn(() => mock),
      set: vi.fn(() => mock),
      onConflictDoUpdate: vi.fn(() => mock),
    };
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
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    sql: vi.fn((strings, ...values) => ({ type: 'sql', strings, values })),
    exists: vi.fn((...args) => ({ type: 'exists', args })),
  };
});

describe('FogOfWarService', () => {
  const mockSceneId = 'scene-123';
  const mockUserId = 'user-123';
  const mockRequesterId = 'user-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('verifyAccess (internal)', () => {
    it('should allow access if requester is the scene owner', async () => {
      // Mock the authorization query to return a row (access granted)
      const mockSelectBuilder = (db as any).select();
      mockSelectBuilder.limit.mockResolvedValue([{ id: mockSceneId }]);
      (db as any).select.mockReturnValue(mockSelectBuilder);

      // We call a method that uses verifyAccess internally
      await expect(FogOfWarService.getRevealedAreas(mockSceneId, mockUserId, mockUserId)).resolves.toBeDefined();
    });

    it('should throw NotFoundError if scene does not exist or access is denied', async () => {
      // Mock the authorization query to return no rows (access denied or not found)
      const mockSelectBuilder = (db as any).select();
      mockSelectBuilder.limit.mockResolvedValue([]);
      (db as any).select.mockReturnValue(mockSelectBuilder);

      await expect(FogOfWarService.getRevealedAreas(mockSceneId, mockUserId, mockUserId)).rejects.toThrow('Scene not found');
    });

    it('should allow access if requester is target and is a participant', async () => {
      const mockSelectBuilder = (db as any).select();
      mockSelectBuilder.limit.mockResolvedValue([{ id: mockSceneId }]);
      (db as any).select.mockReturnValue(mockSelectBuilder);

      await expect(FogOfWarService.getRevealedAreas(mockSceneId, mockUserId, mockUserId)).resolves.toBeDefined();
    });

    it('should deny access if requester is target but not a participant', async () => {
      // Access conditions pushed to SQL, so non-matching rows return empty array
      const mockSelectBuilder = (db as any).select();
      mockSelectBuilder.limit.mockResolvedValue([]);
      (db as any).select.mockReturnValue(mockSelectBuilder);

      await expect(FogOfWarService.getRevealedAreas(mockSceneId, mockUserId, mockUserId)).rejects.toThrow('Scene not found');
    });
  });

  describe('revealAreas', () => {
    it('should use atomic UPSERT for revealing areas', async () => {
      // Mock verifyAccess
      const mockSelectBuilder = (db as any).select();
      mockSelectBuilder.limit.mockResolvedValue([{
        sceneOwnerId: mockUserId,
        campaignId: 'camp-123',
        isRequesterParticipant: true,
        isTargetParticipant: true
      }]);
      (db as any).select.mockReturnValue(mockSelectBuilder);

      // Mock the UPSERT
      const mockInsertBuilder = (db as any).insert();
      mockInsertBuilder.values.mockReturnValue(mockInsertBuilder);
      mockInsertBuilder.select.mockReturnValue(mockInsertBuilder);
      mockInsertBuilder.onConflictDoUpdate.mockReturnValue(mockInsertBuilder);
      mockInsertBuilder.returning.mockResolvedValue([{ id: 'upserted-id' }]);
      (db as any).insert.mockReturnValue(mockInsertBuilder);

      const mockInput = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
        revealedBy: 'DM',
      };

      const result = await FogOfWarService.revealAreas(
        mockSceneId,
        mockUserId,
        mockRequesterId,
        [mockInput]
      );

      expect(db.insert).toHaveBeenCalled();
      expect(mockInsertBuilder.onConflictDoUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.anything(),
          set: expect.objectContaining({
            revealedAreas: expect.anything(),
            updatedAt: expect.anything(),
          }),
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        points: mockInput.points,
        revealedBy: mockInput.revealedBy,
      });
    });

    it('should throw ValidationError if polygon has less than 3 points', async () => {
      // Mock verifyAccess
      const mockSelectBuilder = (db as any).select();
      mockSelectBuilder.limit.mockResolvedValue([{
        sceneOwnerId: mockUserId,
        campaignId: 'camp-123',
        isRequesterParticipant: true,
        isTargetParticipant: true
      }]);
      (db as any).select.mockReturnValue(mockSelectBuilder);

      const mockInput = {
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
      };

      await expect(FogOfWarService.revealAreas(
        mockSceneId,
        mockUserId,
        mockRequesterId,
        [mockInput]
      )).rejects.toThrow('A polygon must have at least 3 points');
    });
  });

  describe('revealArea', () => {
    it('should delegate to revealAreas', async () => {
      const spy = vi.spyOn(FogOfWarService, 'revealAreas').mockResolvedValue([{ id: 'area-1' } as any]);

      const mockInput = { points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }] };
      const result = await FogOfWarService.revealArea(
        mockSceneId,
        mockUserId,
        mockRequesterId,
        mockInput
      );

      expect(spy).toHaveBeenCalledWith(
        mockSceneId,
        mockUserId,
        mockRequesterId,
        [mockInput],
        undefined
      );
      expect(result).toEqual({ id: 'area-1' });
    });
  });
});
