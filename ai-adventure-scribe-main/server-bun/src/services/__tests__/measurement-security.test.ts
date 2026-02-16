/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client.js';
import { NotFoundError } from '../../lib/errors.js';
import { MeasurementService } from '../measurement-service.js';

// Mock the db client
vi.mock('../../../../db/client.js', () => {
  const mockQueryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    // Make it thenable to support await
    then: vi.fn(function(this: any, resolve: any) {
      return Promise.resolve(this._results || []).then(resolve);
    }),
  };

  return {
    db: {
      select: vi.fn(() => {
        const qb = { ...mockQueryBuilder };
        qb._results = [];
        qb.limit = vi.fn().mockImplementation(function(this: any, _n: number) {
            return this;
        });
        qb.where = vi.fn().mockImplementation(function(this: any, _cond: any) {
            return this;
        });
        return qb;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([]),
        })),
      })),
    },
  };
});

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual as any,
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
    lt: vi.fn((a, b) => ({ type: 'lt', a, b })),
    exists: vi.fn((qb) => ({ type: 'exists', qb })),
    isNotNull: vi.fn((col) => ({ type: 'isNotNull', col })),
    sql: vi.fn((strings, ...values) => ({ type: 'sql', strings, values })),
  };
});

describe('MeasurementService Security', () => {
  const mockUserId = 'user-123';
  const mockSceneId = 'scene-123';
  const mockTemplateId = 'template-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('cleanupTemporaryTemplates', () => {
    it('should not crash and should verify scene ownership', async () => {
      const qb1 = (db.select() as any);
      qb1._results = [{ userId: mockUserId }]; // Scene ownership check

      (db.select as any).mockReturnValueOnce(qb1);

      // Mock delete
      (db.delete as any).mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }])
      });

      const count = await MeasurementService.cleanupTemporaryTemplates(mockSceneId, mockUserId);
      expect(count).toBe(2);
      expect(db.delete).toHaveBeenCalled();
    });

    it('should throw NotFoundError if scene is not owned', async () => {
      const qb1 = (db.select() as any);
      qb1._results = []; // Scene not found/owned

      (db.select as any).mockReturnValueOnce(qb1);

      await expect(MeasurementService.cleanupTemporaryTemplates(mockSceneId, mockUserId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('calculateAffectedTokens', () => {
    const mockTemplate = {
      id: mockTemplateId,
      sceneId: mockSceneId,
      templateType: 'sphere',
      originX: 100,
      originY: 100,
      distance: 20,
      direction: 0,
    };

    it('should show all tokens to the scene owner (GM)', async () => {
      const qb1 = (db.select() as any);
      qb1._results = [{ template: mockTemplate, sceneOwnerId: mockUserId }]; // GM is the caller

      const qb2 = (db.select() as any);
      qb2._results = [
        { token: { id: 't1', name: 'Token 1', positionX: 105, positionY: 105, isVisible: true, isHidden: false } },
        { token: { id: 't2', name: 'Hidden NPC', positionX: 110, positionY: 110, isVisible: false, isHidden: true } }
      ];

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      const result = await MeasurementService.calculateAffectedTokens(mockTemplateId, mockUserId);

      expect(result.tokenIds).toContain('t1');
      expect(result.tokenIds).toContain('t2');
      expect(result.tokenIds).toHaveLength(2);
    });

    it('should hide invisible tokens from players', async () => {
      const playerUserId = 'player-456';
      const qb1 = (db.select() as any);
      qb1._results = [{ template: mockTemplate, sceneOwnerId: 'gm-789' }]; // Player is the caller

      const qb2 = (db.select() as any);
      // Query builder for tokens would have filters applied, but we mock the result here
      qb2._results = [
        { token: { id: 't1', name: 'Token 1', positionX: 105, positionY: 105, isVisible: true, isHidden: false } }
        // t2 is hidden and not owned by player, so it wouldn't be returned by the DB query
      ];

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      const result = await MeasurementService.calculateAffectedTokens(mockTemplateId, playerUserId);

      expect(result.tokenIds).toContain('t1');
      expect(result.tokenIds).not.toContain('t2');
      expect(result.tokenIds).toHaveLength(1);
    });

    it('should show player-owned tokens even if hidden', async () => {
      const playerUserId = 'player-456';
      const qb1 = (db.select() as any);
      qb1._results = [{ template: mockTemplate, sceneOwnerId: 'gm-789' }];

      const qb2 = (db.select() as any);
      qb2._results = [
        { token: { id: 't1', name: 'Visible Token', positionX: 105, positionY: 105, isVisible: true, isHidden: false } },
        { token: { id: 't-mine', name: 'My Hidden Token', positionX: 110, positionY: 110, isVisible: false, isHidden: true } }
      ];

      (db.select as any)
        .mockReturnValueOnce(qb1)
        .mockReturnValueOnce(qb2);

      const result = await MeasurementService.calculateAffectedTokens(mockTemplateId, playerUserId);

      expect(result.tokenIds).toContain('t1');
      expect(result.tokenIds).toContain('t-mine');
      expect(result.tokenIds).toHaveLength(2);
    });
  });
});
