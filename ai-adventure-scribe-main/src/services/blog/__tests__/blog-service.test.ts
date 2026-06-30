/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  listBlogPosts,
  getBlogPostById,
  getBlogPostBySlug,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost
} from '../blog-service';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => {
  const mockQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return {
    supabase: {
      from: vi.fn(() => mockQuery),
    },
  };
});

describe('blog-service', () => {
  const mockBlogPost = {
    id: '1',
    title: 'Test Post',
    slug: 'test-post',
    content: 'Content',
    summary: 'Excerpt',
    featured_image_url: 'http://example.com/image.jpg',
    status: 'published',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    author_id: 'author-1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listBlogPosts', () => {
    it('should list blog posts and map fields correctly', async () => {
      const mockData = [mockBlogPost];
      const mockQuery = (supabase.from as any)();
      mockQuery.order.mockResolvedValue({ data: mockData, error: null });

      const result = await listBlogPosts();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
      expect(result[0].title).toBe('Test Post');
      expect(result[0].excerpt).toBe('Excerpt');
      expect(result[0].coverImageUrl).toBe('http://example.com/image.jpg');
      expect(supabase.from).toHaveBeenCalledWith('blog_posts');
    });

    it('should apply filters correctly', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.order.mockResolvedValue({ data: [], error: null });

      await listBlogPosts({
        status: 'published',
        scheduledOnly: true,
        search: 'adventure'
      });

      expect(mockQuery.eq).toHaveBeenCalledWith('status', 'published');
      expect(mockQuery.not).toHaveBeenCalledWith('scheduled_for', 'is', null);
      expect(mockQuery.ilike).toHaveBeenCalledWith('title', '%adventure%');
    });

    it('should throw error on Supabase failure', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.order.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(listBlogPosts()).rejects.toThrow('Database error');
    });
  });

  describe('getBlogPostById', () => {
    it('should return a blog post by ID', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockBlogPost, error: null });

      const result = await getBlogPostById('1');

      expect(result?.id).toBe('1');
      expect(mockQuery.eq).toHaveBeenCalledWith('id', '1');
    });

    it('should return null if post not found', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await getBlogPostById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getBlogPostBySlug', () => {
    it('should return a blog post by slug', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.maybeSingle.mockResolvedValue({ data: mockBlogPost, error: null });

      const result = await getBlogPostBySlug('test-post');

      expect(result?.slug).toBe('test-post');
      expect(mockQuery.eq).toHaveBeenCalledWith('slug', 'test-post');
    });
  });

  describe('createBlogPost', () => {
    it('should create a blog post with correct payload', async () => {
      const input = {
        title: 'New Post',
        slug: 'new-post',
        content: 'New Content',
        excerpt: 'New Excerpt',
        status: 'draft' as any,
        allowComments: true,
      };
      const mockQuery = (supabase.from as any)();
      mockQuery.single.mockResolvedValue({ data: { ...mockBlogPost, ...input, id: '2' }, error: null });

      const result = await createBlogPost(input);

      expect(result.id).toBe('2');
      expect(result.title).toBe('New Post');
      expect(mockQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
        title: 'New Post',
        slug: 'new-post',
        content: 'New Content',
        summary: 'New Excerpt',
      }));
    });
  });

  describe('updateBlogPost', () => {
    it('should update a blog post', async () => {
      const input = { title: 'Updated Title' };
      const mockQuery = (supabase.from as any)();
      mockQuery.single.mockResolvedValue({ data: { ...mockBlogPost, title: 'Updated Title' }, error: null });

      const result = await updateBlogPost('1', input);

      expect(result.title).toBe('Updated Title');
      expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Updated Title',
      }));
    });

    it('should return existing post if no changes provided', async () => {
      const mockQuery = (supabase.from as any)();
      // First call is for update check, then getBlogPostById is called
      mockQuery.maybeSingle.mockResolvedValue({ data: mockBlogPost, error: null });

      const result = await updateBlogPost('1', {});

      expect(result.id).toBe('1');
      expect(mockQuery.update).not.toHaveBeenCalled();
    });

    it('should throw if post to update without changes is not found', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

      await expect(updateBlogPost('1', {})).rejects.toThrow('Unable to load blog post for update');
    });
  });

  describe('deleteBlogPost', () => {
    it('should delete a blog post', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.eq.mockResolvedValue({ error: null });

      await deleteBlogPost('1');

      expect(mockQuery.delete).toHaveBeenCalled();
      expect(mockQuery.eq).toHaveBeenCalledWith('id', '1');
    });

    it('should throw error on delete failure', async () => {
      const mockQuery = (supabase.from as any)();
      mockQuery.eq.mockResolvedValue({ error: { message: 'Delete failed' } });

      await expect(deleteBlogPost('1')).rejects.toThrow('Delete failed');
    });
  });
});
