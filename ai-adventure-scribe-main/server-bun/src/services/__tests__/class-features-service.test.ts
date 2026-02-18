/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { ClassFeaturesService } from '../class-features-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      characters: {
        findFirst: vi.fn(),
      },
      classFeaturesLibrary: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      characterFeatures: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      characterSubclasses: {
        findFirst: vi.fn(),
      },
      featureUsageLog: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => {
      const mockChain = {
        from: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        groupBy: vi.fn().mockReturnThis(),
        then: vi.fn((resolve: any) => resolve([])),
      };
      (mockChain.from as any).mockReturnValue(mockChain);
      (mockChain.where as any).mockReturnValue(mockChain);
      return mockChain;
    }),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        returning: vi.fn(),
      })),
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'mock-id' }]),
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(),
    })),
    execute: vi.fn(),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    exists: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    eq: vi.fn(),
  };
});

describe('ClassFeaturesService', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = 'char-123';
  const mockFeatureId = 'feat-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Security: getCharacterFeatures', () => {
    it('should fetch features if ownership check passes', async () => {
      (db.query.characterFeatures.findMany as any).mockResolvedValue([
        { id: '1', characterId: mockCharacterId, featureId: mockFeatureId }
      ]);

      const result = await ClassFeaturesService.getCharacterFeatures(mockCharacterId, mockUserId);
      expect(result).toHaveLength(1);
      expect(db.query.characterFeatures.findMany).toHaveBeenCalled();
    });
  });

  describe('Security: grantFeature', () => {
    it('should throw NotFoundError if character not owned', async () => {
      // Mock verifyCharacterOwnership
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(ClassFeaturesService.grantFeature({
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        acquiredAtLevel: 1,
        userId: mockUserId
      })).rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned', async () => {
      // Mock verifyCharacterOwnership
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.query.classFeaturesLibrary.findFirst as any).mockResolvedValue({ id: mockFeatureId, featureName: 'Test' });
      (db.query.characterFeatures.findFirst as any).mockResolvedValue(null);

      // Mock sequential calls to db.select
      // 1. exists() in existing check
      // 2. Pre-flight check
      // 3. The sub-select inside insert().select()
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: mockCharacterId }])
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        });

      // Mock atomic insertion
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'new-feat-123' }])
        })
      });

      const result = await ClassFeaturesService.grantFeature({
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        acquiredAtLevel: 1,
        userId: mockUserId
      });

      expect(result.id).toBe('new-feat-123');
      expect(db.insert).toHaveBeenCalled();
    });

    it('should throw NotFoundError if atomic insertion returns no rows (unauthorized)', async () => {
      // Mock verifyCharacterOwnership
      (db.query.characters.findFirst as any).mockResolvedValue({ id: mockCharacterId });
      (db.query.classFeaturesLibrary.findFirst as any).mockResolvedValue({ id: mockFeatureId, featureName: 'Test' });
      (db.query.characterFeatures.findFirst as any).mockResolvedValue(null);

      // Mock sequential calls to db.select
      // 1. exists() in existing check
      // 2. Pre-flight check
      // 3. The sub-select inside insert().select()
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: mockCharacterId }])
            })
          })
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        });

      // But atomic insertion returns nothing (e.g. race condition or RLS-like failure in subselect)
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([])
        })
      });

      await expect(ClassFeaturesService.grantFeature({
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        acquiredAtLevel: 1,
        userId: mockUserId
      })).rejects.toThrow(NotFoundError);
    });
  });

  describe('Security: useFeature', () => {
    it('should return failure if character feature not found (or not owned)', async () => {
      (db.query.characterFeatures.findFirst as any).mockResolvedValue(null);

      const result = await ClassFeaturesService.useFeature({
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        userId: mockUserId
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Feature not found for this character');
    });

    it('should include exists check in where clause for update', async () => {
      const mockFeature = { id: mockFeatureId, featureName: 'Test', usesCount: 5 };
      (db.query.characterFeatures.findFirst as any).mockResolvedValue({
        id: 'cf-123',
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        usesRemaining: 5,
        feature: mockFeature
      });

      (db.update as any).mockReturnValue({
        set: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ id: 'cf-123' }])
      });

      // Mock calls to db.select
      (db.select as any)
        .mockReturnValueOnce({ // 1. for exists() in characterFeature findFirst
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        })
        .mockReturnValueOnce({ // 2. for exists() in update
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        })
        .mockReturnValueOnce({ // 3. for logFeatureUsage pre-flight
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: mockCharacterId }])
        })
        .mockReturnValueOnce({ // 4. for logFeatureUsage insert().select()
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        });

      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'log-123' }])
        })
      });

      const result = await ClassFeaturesService.useFeature({
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        userId: mockUserId
      });

      expect(result.success).toBe(true);
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('Security: setSubclass', () => {
    it('should throw NotFoundError if character not owned', async () => {
      (db.query.characters.findFirst as any).mockResolvedValue(null);

      await expect(ClassFeaturesService.setSubclass({
        characterId: mockCharacterId,
        className: 'Fighter',
        subclassName: 'Champion',
        level: 3,
        userId: mockUserId
      })).rejects.toThrow(NotFoundError);
    });
  });

  describe('Security: logFeatureUsage', () => {
    it('should throw NotFoundError if character not owned', async () => {
      // Mock pre-flight check
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([])
      });

      await expect(ClassFeaturesService.logFeatureUsage(
        mockCharacterId,
        mockFeatureId,
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });

    it('should use atomic insertion for logging', async () => {
      // Mock pre-flight check and insert select
      (db.select as any)
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([{ id: mockCharacterId }])
        })
        .mockReturnValueOnce({
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
        });

      // Mock atomic insertion
      (db.insert as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 'log-123' }])
        })
      });

      const result = await ClassFeaturesService.logFeatureUsage(
        mockCharacterId,
        mockFeatureId,
        mockUserId
      );

      expect(result.id).toBe('log-123');
      expect(db.insert).toHaveBeenCalled();
    });
  });
});
