import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  resolveAuthorId,
  canManagePost,
  normalizeStatusFields,
  syncPostRelations,
  syncPostCategories,
  syncPostTags
} from '../blog-helpers.js';
import { TRPCError } from '@trpc/server';

describe('Blog Helpers - Security and Functionality', () => {
  let mockCtx: any;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockResolvedValue([]),
    };

    mockCtx = {
      db: mockDb,
      user: {
        userId: 'user-123',
        plan: 'enterprise',
      },
    };
  });

  describe('resolveAuthorId', () => {
    it('should NOT treat enterprise users as admins for author override', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'author-123' }]);
      const result = await resolveAuthorId(mockCtx, 'author-123');
      expect(result).toBe('author-123');
    });

    it('should throw NOT_FOUND if enterprise user tries to override to another author', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(resolveAuthorId(mockCtx, 'other-author')).rejects.toThrow(
        expect.objectContaining({ code: 'NOT_FOUND' }) as any
      );
    });

    it('should treat admin plan as admin', async () => {
      mockCtx.user.plan = 'admin';
      mockDb.limit.mockResolvedValueOnce([{ id: 'other-author' }]);
      const result = await resolveAuthorId(mockCtx, 'other-author');
      expect(result).toBe('other-author');
    });

    it('should fetch own author profile if no explicit ID provided', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'own-author' }]);
      const result = await resolveAuthorId(mockCtx);
      expect(result).toBe('own-author');
    });

    it('should throw UNAUTHORIZED if user is missing', async () => {
      delete mockCtx.user;
      await expect(resolveAuthorId(mockCtx)).rejects.toThrow(
        expect.objectContaining({ code: 'UNAUTHORIZED' }) as any
      );
    });

    it('should throw BAD_REQUEST if no author profile exists for user', async () => {
      mockDb.limit.mockResolvedValueOnce([]);
      await expect(resolveAuthorId(mockCtx)).rejects.toThrow(
        expect.objectContaining({ code: 'BAD_REQUEST' }) as any
      );
    });
  });

  describe('canManagePost', () => {
    it('should return isAdmin: false for enterprise users', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'user-author-id' }]);
      const result = await canManagePost(mockCtx, 'post-1', 'different-author-id');
      expect(result.isAdmin).toBe(false);
      expect(result.canManage).toBe(false);
    });

    it('should return isAdmin: true for admin plan users', async () => {
      mockCtx.user.plan = 'admin';
      mockDb.limit.mockResolvedValueOnce([{ id: 'user-author-id' }]);
      const result = await canManagePost(mockCtx, 'post-1', 'different-author-id');
      expect(result.isAdmin).toBe(true);
      expect(result.canManage).toBe(true);
    });

    it('should allow author to manage their own post', async () => {
      mockDb.limit.mockResolvedValueOnce([{ id: 'author-1' }]);
      const result = await canManagePost(mockCtx, 'post-1', 'author-1');
      expect(result.canManage).toBe(true);
    });

    it('should return false if no user in context', async () => {
      delete mockCtx.user;
      const result = await canManagePost(mockCtx, 'post-1', 'author-1');
      expect(result.canManage).toBe(false);
    });
  });

  describe('normalizeStatusFields', () => {
    it('should handle published status', () => {
      const now = new Date().toISOString();
      const result = normalizeStatusFields('published', null, now);
      expect(result.status).toBe('published');
      expect(result.publishedAt).toBeInstanceOf(Date);
      expect(result.scheduledFor).toBeNull();
    });

    it('should handle scheduled status', () => {
      const future = new Date(Date.now() + 100000).toISOString();
      const result = normalizeStatusFields('scheduled', future);
      expect(result.status).toBe('scheduled');
      expect(result.scheduledFor).toBeInstanceOf(Date);
      expect(result.publishedAt).toBeNull();
    });

    it('should handle draft status', () => {
      const result = normalizeStatusFields('draft');
      expect(result.status).toBe('draft');
      expect(result.publishedAt).toBeNull();
      expect(result.scheduledFor).toBeNull();
    });
  });

  describe('syncPostRelations', () => {
    it('should call both sync tasks if IDs are provided', async () => {
      // Very minimal mock for the internal calls
      mockDb.delete.mockReturnThis();
      mockDb.where.mockReturnThis();

      await syncPostRelations(mockCtx, 'post-1', ['cat-1'], ['tag-1']);

      expect(mockDb.delete).toHaveBeenCalledTimes(2);
    });
  });

  describe('syncPostCategories', () => {
    it('should perform atomic delete and insert for non-admins', async () => {
      mockDb.delete.mockReturnThis();
      mockDb.where.mockReturnThis();
      mockDb.insert.mockReturnThis();
      mockDb.select.mockReturnThis();

      await syncPostCategories(mockCtx, 'post-1', ['cat-1'], 'author-1', false);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('syncPostTags', () => {
    it('should perform atomic delete and insert for admins', async () => {
      mockDb.delete.mockReturnThis();
      mockDb.where.mockReturnThis();
      mockDb.insert.mockReturnThis();
      mockDb.values.mockResolvedValueOnce([]);

      await syncPostTags(mockCtx, 'post-1', ['tag-1'], 'author-1', true);

      expect(mockDb.delete).toHaveBeenCalled();
      expect(mockDb.insert).toHaveBeenCalled();
      expect(mockDb.values).toHaveBeenCalled();
    });
  });
});
