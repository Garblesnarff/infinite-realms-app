/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { verifySessionOwnership } from '../chronicles.js';

// Mock the db client
vi.mock('../../../../../db/client', () => {
  const mockQueryBuilder: any = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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
        return qb;
      }),
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
  };
});

describe('Chronicles Security - verifySessionOwnership', () => {
  const mockUserId = 'user-123';
  const mockSessionId = 'session-123';

  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = {
      user: { userId: mockUserId },
      db: {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: vi.fn(function(this: any, resolve: any) {
          return Promise.resolve(this._results || []).then(resolve);
        }),
      },
    };
  });

  it('should allow access if user owns the campaign', async () => {
    mockCtx.db._results = [{
      sessionId: mockSessionId,
      campaignUserId: mockUserId,
      characterUserId: 'other-user',
      characterOwnerId: 'other-user',
    }];

    const result = await verifySessionOwnership(mockCtx, mockSessionId);
    expect(result.sessionId).toBe(mockSessionId);
  });

  it('should allow access if user is the character user', async () => {
    mockCtx.db._results = [{
      sessionId: mockSessionId,
      campaignUserId: 'other-user',
      characterUserId: mockUserId,
      characterOwnerId: 'other-user',
    }];

    const result = await verifySessionOwnership(mockCtx, mockSessionId);
    expect(result.sessionId).toBe(mockSessionId);
  });

  it('should allow access if user is the character owner', async () => {
    mockCtx.db._results = [{
      sessionId: mockSessionId,
      campaignUserId: 'other-user',
      characterUserId: 'other-user',
      characterOwnerId: mockUserId,
    }];

    const result = await verifySessionOwnership(mockCtx, mockSessionId);
    expect(result.sessionId).toBe(mockSessionId);
  });

  it('should throw NOT_FOUND if session does not exist', async () => {
    mockCtx.db._results = [];

    await expect(verifySessionOwnership(mockCtx, mockSessionId)).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }) as any,
    );
  });

  it('should throw NOT_FOUND if user has no ownership (masks existence)', async () => {
    mockCtx.db._results = [
      {
        sessionId: mockSessionId,
        campaignUserId: 'other-user',
        characterUserId: 'other-user',
        characterOwnerId: 'other-user',
      },
    ];

    await expect(verifySessionOwnership(mockCtx, mockSessionId)).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }) as any,
    );
  });
});
