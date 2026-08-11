/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { MeasurementService } from '../measurement-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => {
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
      insert: vi.fn(() => {
        const insertMock: any = {
          values: vi.fn(() => insertMock),
          select: vi.fn(() => insertMock),
          returning: vi.fn().mockResolvedValue([]),
        };
        return insertMock;
      }),
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

  describe('createTemplate', () => {
    const mockData: any = {
      templateType: 'sphere',
      originX: 100,
      originY: 100,
      direction: 0,
      distance: 20,
    };

    it('should use atomic INSERT ... SELECT for ownership verification', async () => {
      const mockInsertBuilder = (db as any).insert();
      mockInsertBuilder.select.mockReturnValue(mockInsertBuilder);
      mockInsertBuilder.returning.mockResolvedValue([{ id: mockTemplateId, sceneId: mockSceneId }]);
      (db as any).insert.mockReturnValue(mockInsertBuilder);

      const result = await MeasurementService.createTemplate(mockSceneId, mockUserId, mockData);

      expect(db.insert).toHaveBeenCalled();
      expect(mockInsertBuilder.select).toHaveBeenCalled();
      expect(result.id).toBe(mockTemplateId);
    });

    it('should throw NotFoundError if insertion fails (unauthorized or missing scene)', async () => {
      const mockInsertBuilder = (db as any).insert();
      mockInsertBuilder.select.mockReturnValue(mockInsertBuilder);
      mockInsertBuilder.returning.mockResolvedValue([]); // No row inserted means no access
      (db as any).insert.mockReturnValue(mockInsertBuilder);

      await expect(MeasurementService.createTemplate(mockSceneId, mockUserId, mockData))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('cleanupTemporaryTemplates', () => {
    it('should use atomic DELETE with ownership check via exists', async () => {
      const mockDeleteBuilder: any = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 't1' }, { id: 't2' }])
      };
      (db.delete as any).mockReturnValueOnce(mockDeleteBuilder);

      const count = await MeasurementService.cleanupTemporaryTemplates(mockSceneId, mockUserId);

      expect(count).toBe(2);
      expect(db.delete).toHaveBeenCalled();

      // Verify that the where clause was called with an "exists" condition
      const whereArgs = mockDeleteBuilder.where.mock.calls[0][0];
      // Search for the exists condition in the 'and' arguments
      const hasExists = whereArgs.args.some((arg: any) => arg.type === 'exists');
      expect(hasExists).toBe(true);
    });

    it('should return 0 if no templates found or scene not owned (masked)', async () => {
      const mockDeleteBuilder: any = {
        where: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([])
      };
      (db.delete as any).mockReturnValueOnce(mockDeleteBuilder);

      const count = await MeasurementService.cleanupTemporaryTemplates(mockSceneId, mockUserId);
      expect(count).toBe(0);
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
        { id: 't1', name: 'Token 1', positionX: 105, positionY: 105, isVisible: true, isHidden: false },
        { id: 't2', name: 'Hidden NPC', positionX: 110, positionY: 110, isVisible: false, isHidden: true }
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
        { id: 't1', name: 'Token 1', positionX: 105, positionY: 105, isVisible: true, isHidden: false }
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
        { id: 't1', name: 'Visible Token', positionX: 105, positionY: 105, isVisible: true, isHidden: false },
        { id: 't-mine', name: 'My Hidden Token', positionX: 110, positionY: 110, isVisible: false, isHidden: true }
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
