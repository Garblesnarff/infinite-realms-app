/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { SceneService } from '../scene-service.js';
import { NotFoundError } from '../../lib/errors.js';

// Mock the db client
vi.mock('../../../../db/client', () => {
  const mockDb = {
    query: {
      campaigns: {
        findFirst: vi.fn(),
      },
      scenes: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      sceneSettings: {
        findFirst: vi.fn(),
      },
      sceneLayers: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn((cb) => cb(mockDb)),
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
      groupBy: vi.fn(() => mock),
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
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    exists: vi.fn((subquery) => ({ type: 'exists', subquery })),
    desc: vi.fn((col) => ({ type: 'desc', col })),
    sql: vi.fn((strings, ...values) => ({ type: 'sql', strings, values })),
  };
});

describe('SceneService', () => {
  const mockUserId = 'user-123';
  const mockCampaignId = 'campaign-123';
  const mockSceneId = 'scene-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('updateScene', () => {
    it('should update scene and return it when ownership is verified', async () => {
      const mockUpdates = { name: 'Updated Scene' };
      const mockUpdatedScene = { id: mockSceneId, ...mockUpdates };

      const mockUpdateBuilder = (db as any).update();
      mockUpdateBuilder.returning.mockResolvedValue([mockUpdatedScene]);
      (db as any).update.mockReturnValue(mockUpdateBuilder);

      const result = await SceneService.updateScene(mockSceneId, mockUserId, mockUpdates);

      expect(db.update).toHaveBeenCalled();
      expect(result).toEqual(mockUpdatedScene);
      // verifySceneOwnership should not be called anymore
      expect(db.query.scenes.findFirst).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if scene does not exist or is not owned', async () => {
      const mockUpdateBuilder = (db as any).update();
      mockUpdateBuilder.returning.mockResolvedValue([]);
      (db as any).update.mockReturnValue(mockUpdateBuilder);

      await expect(SceneService.updateScene(mockSceneId, mockUserId, { name: 'Fail' }))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('deleteScene', () => {
    it('should delete scene when ownership is verified', async () => {
      const mockDeleteBuilder = (db as any).delete();
      mockDeleteBuilder.returning.mockResolvedValue([{ id: mockSceneId }]);
      (db as any).delete.mockReturnValue(mockDeleteBuilder);

      const result = await SceneService.deleteScene(mockSceneId, mockUserId);

      expect(db.delete).toHaveBeenCalled();
      expect(result).toBe(true);
      expect(db.query.scenes.findFirst).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if scene does not exist or is not owned', async () => {
      const mockDeleteBuilder = (db as any).delete();
      mockDeleteBuilder.returning.mockResolvedValue([]);
      (db as any).delete.mockReturnValue(mockDeleteBuilder);

      await expect(SceneService.deleteScene(mockSceneId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('setActiveScene', () => {
    it('should successfully activate a scene and deactivate others', async () => {
      const mockScene = { id: mockSceneId, campaignId: mockCampaignId, userId: mockUserId };
      (db.query.scenes.findFirst as any).mockResolvedValue(mockScene);

      const mockUpdateBuilder = (db as any).update();
      mockUpdateBuilder.returning.mockResolvedValue([
        { id: mockSceneId, isActive: true },
        { id: 'other-scene', isActive: false }
      ]);
      (db as any).update.mockReturnValue(mockUpdateBuilder);

      const result = await SceneService.setActiveScene(mockSceneId, mockCampaignId, mockUserId);

      expect(db.query.scenes.findFirst).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
      expect(result.isActive).toBe(true);
      expect(result.id).toBe(mockSceneId);
    });

    it('should throw NotFoundError if scene is not in campaign', async () => {
      (db.query.scenes.findFirst as any).mockResolvedValue(null);
      (db.query.campaigns.findFirst as any).mockResolvedValue({ id: mockCampaignId });

      await expect(SceneService.setActiveScene(mockSceneId, mockCampaignId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('updateLayer', () => {
    it('should update layer atomically without pre-fetching', async () => {
      const mockLayerId = 'layer-123';
      const mockUpdates = { isVisible: false };
      const mockUpdatedLayer = { id: mockLayerId, ...mockUpdates };

      const mockUpdateBuilder = (db as any).update();
      mockUpdateBuilder.returning.mockResolvedValue([mockUpdatedLayer]);
      (db as any).update.mockReturnValue(mockUpdateBuilder);

      const result = await SceneService.updateLayer(mockSceneId, mockLayerId, mockUserId, mockUpdates);

      expect(db.update).toHaveBeenCalled();
      expect(result).toEqual(mockUpdatedLayer);
      expect(db.query.sceneLayers.findFirst).not.toHaveBeenCalled();
    });
  });
});
