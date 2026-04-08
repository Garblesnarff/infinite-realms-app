/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { blogPostsRouter } from '../blog-posts.js';

describe('Blog Posts Router - getBySlug', () => {
  let mockCtx: any;
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      query: {
        blogPosts: {
          findFirst: vi.fn(),
        },
      },
    };

    mockCtx = {
      db: mockDb,
    };
  });

  it('should fetch post with relations and flatten them', async () => {
    const mockPost = {
      id: 'post-1',
      title: 'Test Post',
      slug: 'test-post',
      status: 'published',
      author: { id: 'author-1', displayName: 'Author One' },
      categories: [
        { category: { id: 'cat-1', slug: 'cat-1', name: 'Category 1' } },
      ],
      tags: [
        { tag: { id: 'tag-1', slug: 'tag-1', name: 'Tag 1' } },
      ],
    };

    mockDb.query.blogPosts.findFirst.mockResolvedValue(mockPost);

    const caller = blogPostsRouter.createCaller(mockCtx);
    const result = await caller.getBySlug({ slug: 'test-post' });

    expect(mockDb.query.blogPosts.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        with: expect.objectContaining({
          author: true,
          categories: expect.anything(),
          tags: expect.anything(),
        }),
      })
    );

    expect(result.title).toBe('Test Post');
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0].name).toBe('Category 1');
    expect(result.tags).toHaveLength(1);
    expect(result.tags[0].name).toBe('Tag 1');
  });

  it('should throw NOT_FOUND if post does not exist', async () => {
    mockDb.query.blogPosts.findFirst.mockResolvedValue(null);

    const caller = blogPostsRouter.createCaller(mockCtx);
    await expect(caller.getBySlug({ slug: 'non-existent' })).rejects.toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }) as any
    );
  });
});
