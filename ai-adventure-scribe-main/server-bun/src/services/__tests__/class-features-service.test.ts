/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client.js';
import { NotFoundError } from '../../lib/errors.js';
import { ClassFeaturesService } from '../class-features-service.js';

// Mock the db client
vi.mock('../../../../db/client.js', () => ({
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
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(),
        })),
        innerJoin: vi.fn(() => ({
          where: vi.fn(),
        })),
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
      // Mock getFeatureById
      (db.query.classFeaturesLibrary.findFirst as any).mockResolvedValue({ id: mockFeatureId, featureName: 'Test' });
      // Mock existing check (returns null but ownership subquery would fail in real DB)
      (db.query.characterFeatures.findFirst as any).mockResolvedValue(null);
      // Mock character ownership check
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      await expect(ClassFeaturesService.grantFeature({
        characterId: mockCharacterId,
        featureId: mockFeatureId,
        acquiredAtLevel: 1,
        userId: mockUserId
      })).rejects.toThrow(NotFoundError);
    });

    it('should succeed if character is owned', async () => {
      (db.query.classFeaturesLibrary.findFirst as any).mockResolvedValue({ id: mockFeatureId, featureName: 'Test' });
      (db.query.characterFeatures.findFirst as any).mockResolvedValue(null);
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: mockCharacterId }])
          })
        })
      });
      (db.insert as any).mockReturnValue({
        values: vi.fn().mockReturnValue({
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
      (db.select as any).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([])
          })
        })
      });

      await expect(ClassFeaturesService.logFeatureUsage(
        mockCharacterId,
        mockFeatureId,
        mockUserId
      )).rejects.toThrow(NotFoundError);
    });
  });
});
