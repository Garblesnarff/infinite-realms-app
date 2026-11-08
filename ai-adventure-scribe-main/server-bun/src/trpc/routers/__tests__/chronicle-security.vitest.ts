/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// chronicle-generator imports AIUsageService, which validates env at load.
vi.hoisted(() => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
  });
});

import { verifySessionOwnership, chroniclesRouter } from '../chronicles.js';
import { chronicleGenerator } from '../../../services/chronicle-generator.js';

// Mock the db client
vi.mock('../../../../../db/client', () => {
  const mockQueryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    // Make it thenable to support await
    then: vi.fn(function (this: any, resolve: any) {
      return Promise.resolve(this._results || []).then(resolve);
    }),
  };

  return {
    db: {
      select: vi.fn(() => {
        const qb = { ...mockQueryBuilder };
        qb._results = [];
        return qb;
      }),
      insert: vi.fn(() => {
        const qb = { ...mockQueryBuilder };
        qb._results = [];
        return qb;
      }),
      update: vi.fn(() => {
        const qb = { ...mockQueryBuilder };
        qb._results = [];
        return qb;
      }),
    },
  };
});

// Mock chronicle generator to avoid actual generation
vi.mock('../../services/chronicle-generator.js', () => ({
  chronicleGenerator: {
    generateProChronicle: vi.fn(),
    generateFreeChronicle: vi.fn(),
    generateIllustration: vi.fn(),
    generateShareToken: vi.fn(),
  },
}));

// Mock drizzle-orm
vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...(actual as any),
    and: vi.fn((...args) => ({ type: 'and', args })),
    or: vi.fn((...args) => ({ type: 'or', args })),
    eq: vi.fn((a, b) => ({ type: 'eq', a, b })),
  };
});

// #1344: the generate procedure re-resolves the plan strictly (ctx.user.plan is
// lenient). The holder lets each test pick the strict lookup's outcome.
const planState = vi.hoisted(() => ({ plan: 'free', throw: false }));
vi.mock('../../../lib/user-plan.js', () => ({
  resolveUserPlanStrict: async () => {
    if (planState.throw) throw new Error('plan lookup db unavailable (test injection)');
    return planState.plan;
  },
  resolveUserPlan: async () => planState.plan,
}));

describe('Chronicles Security', () => {
  const mockUserId = 'user-123';
  const mockSessionId = '123e4567-e89b-12d3-a456-426614174000';

  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup a common mock structure for both verifySessionOwnership and router tests
    const createMockQB = () => {
      const qb: any = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        innerJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        returning: vi.fn().mockReturnThis(),
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        _results: [],
        then: vi.fn(function (this: any, resolve: any) {
          return Promise.resolve(this._results || []).then(resolve);
        }),
      };
      return qb;
    };

    const mockDB: any = {
      select: vi.fn(() => createMockQB()),
      insert: vi.fn(() => createMockQB()),
      update: vi.fn(() => createMockQB()),
    };

    mockCtx = {
      user: { userId: mockUserId, plan: 'free' },
      db: mockDB,
    };
    // Keep the strict plan lookup in sync with the ctx plan unless a test overrides it.
    planState.plan = mockCtx.user.plan;
    planState.throw = false;
  });

  describe('verifySessionOwnership', () => {
    it('should include ownership filters in the WHERE clause', async () => {
      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);
      qb._results = [{ sessionId: mockSessionId }];

      await verifySessionOwnership(mockCtx, mockSessionId);

      expect(qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockSessionId }),
            expect.objectContaining({
              type: 'or',
              args: expect.arrayContaining([
                expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
              ]),
            }),
          ]),
        }),
      );
    });

    it('should throw NOT_FOUND if session does not exist or user has no ownership', async () => {
      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);
      qb._results = [];

      await expect(verifySessionOwnership(mockCtx, mockSessionId)).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }) as any,
      );
    });
  });

  describe('chroniclesRouter scoping', () => {
    it('getBySessionId should filter by userId and verify ownership', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);

      // Return a mock result with ID to avoid NOT_FOUND error and to signify chronicle existence
      qb._results = [{ id: 'chronicle-123' }];

      await caller.getBySessionId({ sessionId: mockSessionId });

      // Bolt: The consolidated query includes ownership filters in the WHERE clause
      expect(qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockSessionId }),
            expect.objectContaining({
              type: 'or',
              args: expect.arrayContaining([
                expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
              ]),
            }),
          ]),
        }),
      );
      const selectArg = mockCtx.db.select.mock.calls.at(-1)?.[0];
      expect(selectArg).toHaveProperty('sessionNumber');
    });

    it('generate should filter by userId when checking existing chronicles', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);

      let queryCount = 0;
      qb.then = vi.fn(function (this: any, resolve: any) {
        queryCount++;
        if (queryCount === 1) {
          // verifySessionOwnership call
          return Promise.resolve([{ sessionId: mockSessionId }]).then(resolve);
        } else if (queryCount === 2) {
          // check existing chronicle call
          return Promise.resolve([]).then(resolve);
        } else {
          return Promise.resolve([{ id: 'new-chronicle' }]).then(resolve);
        }
      });

      const insertQB = mockCtx.db.insert();
      mockCtx.db.insert.mockReturnValue(insertQB);
      insertQB._results = [{ id: 'new-chronicle' }];

      await caller.generate({ sessionId: mockSessionId });

      // The second select query's where call should be the check for existing chronicles
      expect(qb.where).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockSessionId }),
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
          ]),
        }),
      );
    });

    it('generate should use userId filter when updating an existing chronicle', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);

      const mockChronicleId = 'existing-chronicle-id';
      let queryCount = 0;
      qb.then = vi.fn(function (this: any, resolve: any) {
        queryCount++;
        if (queryCount === 1) {
          // verifySessionOwnership call
          return Promise.resolve([{ sessionId: mockSessionId }]).then(resolve);
        } else {
          // check existing chronicle call - return an existing one
          return Promise.resolve([{ id: mockChronicleId, status: 'failed' }]).then(resolve);
        }
      });

      const updateQB = mockCtx.db.update();
      mockCtx.db.update.mockReturnValue(updateQB);

      await caller.generate({ sessionId: mockSessionId });

      // Verify update call includes userId filter
      expect(updateQB.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockChronicleId }),
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
          ]),
        }),
      );
    });

    it.each([
      ['pro', 'generateProChronicle'],
      ['enterprise', 'generateProChronicle'],
      ['tester', 'generateProChronicle'],
      ['free', 'generateFreeChronicle'],
    ] as const)('generate gives a %s account the %s tier (#2474)', async (plan, generator) => {
      mockCtx.user.plan = plan;
      planState.plan = plan;
      const proSpy = vi
        .spyOn(chronicleGenerator, 'generateProChronicle')
        .mockRejectedValue(new Error('stop after the tier is chosen'));
      const freeSpy = vi
        .spyOn(chronicleGenerator, 'generateFreeChronicle')
        .mockRejectedValue(new Error('stop after the tier is chosen'));
      const caller = chroniclesRouter.createCaller(mockCtx);

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);
      let queryCount = 0;
      qb.then = vi.fn(function (this: any, resolve: any) {
        queryCount++;
        const rows = queryCount === 1 ? [{ sessionId: mockSessionId }] : [];
        return Promise.resolve(rows).then(resolve);
      });
      const insertQB = mockCtx.db.insert();
      mockCtx.db.insert.mockReturnValue(insertQB);
      insertQB._results = [{ id: 'new-chronicle' }];

      await caller.generate({ sessionId: mockSessionId });

      const chosen = generator === 'generateProChronicle' ? proSpy : freeSpy;
      const other = generator === 'generateProChronicle' ? freeSpy : proSpy;
      await vi.waitFor(() => expect(chosen).toHaveBeenCalledTimes(1));
      expect(other).not.toHaveBeenCalled();
    });

    it('generate marks the row failed and throws when the plan lookup throws (#1344)', async () => {
      planState.throw = true;
      const caller = chroniclesRouter.createCaller(mockCtx);

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);
      let queryCount = 0;
      qb.then = vi.fn(function (this: any, resolve: any) {
        queryCount++;
        const rows = queryCount === 1 ? [{ sessionId: mockSessionId }] : [];
        return Promise.resolve(rows).then(resolve);
      });
      const insertQB = mockCtx.db.insert();
      mockCtx.db.insert.mockReturnValue(insertQB);
      insertQB._results = [{ id: 'new-chronicle' }];
      const updateQB = mockCtx.db.update();
      mockCtx.db.update.mockReturnValue(updateQB);

      let caught: any;
      try {
        await caller.generate({ sessionId: mockSessionId });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe('INTERNAL_SERVER_ERROR');
      expect(caught.message).toBe('Plan lookup unavailable');
      expect(updateQB.set).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          errorMessage: 'plan_lookup_failed',
        }),
      );
      // The failed-marking update is user-scoped, like the IIFE catch's update.
      expect(updateQB.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: 'new-chronicle' }),
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
          ]),
        }),
      );
    });

    it('getStatus should filter by userId', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);
      const mockChronicleId = '223e4567-e89b-12d3-a456-426614174000';

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);
      qb._results = [{ id: mockChronicleId, userId: mockUserId }];

      await caller.getStatus({ chronicleId: mockChronicleId });

      expect(qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockChronicleId }),
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
          ]),
        }),
      );
    });

    it('getPreviouslyOn should verify session ownership correctly', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);
      const mockCampaignId = '323e4567-e89b-12d3-a456-426614174000';

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);

      qb.then = vi.fn(function (this: any, resolve: any) {
        // Just mock the first call (verifySessionOwnership) for simplicity
        return Promise.resolve([
          {
            sessionId: mockSessionId,
            campaignId: mockCampaignId,
            sessionNumber: 2,
          },
        ]).then(resolve);
      });

      await caller.getPreviouslyOn({
        newSessionId: mockSessionId,
        campaignId: mockCampaignId,
      });

      // Verify the first query (verifySessionOwnership) has ownership check
      expect(qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockSessionId }),
            expect.objectContaining({
              type: 'or',
              args: expect.arrayContaining([
                expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockUserId }),
              ]),
            }),
          ]),
        }),
      );
    });

    it('getByShareToken should NOT filter by userId (public access)', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);
      const mockToken = '12345678901234567890123456789012'; // 32 chars

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);

      qb.then = vi.fn(function (this: any, resolve: any) {
        return Promise.resolve([
          {
            chapterTitle: 'Shared Title',
            sessionId: mockSessionId,
          },
        ]).then(resolve);
      });

      await caller.getByShareToken({ token: mockToken });

      // Verify the first query (getByShareToken) DOES NOT include userId filter
      expect(qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: mockToken }),
          ]),
        }),
      );
    });

    it('getByShareToken filters on share_enabled and never returns previouslyOn', async () => {
      const caller = chroniclesRouter.createCaller(mockCtx);
      const mockToken = '12345678901234567890123456789012';

      const qb = mockCtx.db.select();
      mockCtx.db.select.mockReturnValue(qb);
      mockCtx.db.select.mockClear();

      qb.then = vi.fn(function (this: any, resolve: any) {
        return Promise.resolve([
          {
            chapterTitle: 'Shared Title',
            chronicleText: 'Story',
            illustrationUrl: null,
            generatedAt: null,
            sessionNumber: 2,
            campaignName: 'Campaign',
          },
        ]).then(resolve);
      });

      const result = await caller.getByShareToken({ token: mockToken });

      const selectArg = mockCtx.db.select.mock.calls[0]?.[0];
      expect(selectArg).not.toHaveProperty('previouslyOn');
      expect(selectArg).not.toHaveProperty('sessionId');
      expect(qb.where).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'and',
          args: expect.arrayContaining([
            expect.objectContaining({ type: 'eq', a: expect.anything(), b: true }),
          ]),
        }),
      );
      expect(result).not.toHaveProperty('previouslyOn');
      expect(Object.keys(result).sort()).toEqual([
        'campaignName',
        'chapterTitle',
        'chronicleText',
        'generatedAt',
        'illustrationUrl',
        'sessionNumber',
      ]);
    });
  });
});
