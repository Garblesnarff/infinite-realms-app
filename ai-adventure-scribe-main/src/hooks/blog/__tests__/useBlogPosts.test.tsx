/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  useBlogPosts,
  useBlogPostById,
  useBlogPostBySlug,
  useCreateBlogPost,
  useUpdateBlogPost,
  useDeleteBlogPost,
  useUpdateBlogPostById,
  BLOG_POSTS_QUERY_KEY,
} from '../useBlogPosts';

import * as blogService from '@/services/blog/blog-service';

// Mock the blog service
vi.mock('@/services/blog/blog-service', () => ({
  listBlogPosts: vi.fn(),
  getBlogPostById: vi.fn(),
  getBlogPostBySlug: vi.fn(),
  createBlogPost: vi.fn(),
  updateBlogPost: vi.fn(),
  deleteBlogPost: vi.fn(),
}));

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });

describe('useBlogPosts hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useBlogPosts', () => {
    it('should fetch blog posts', async () => {
      const mockPosts = [
        { id: '1', title: 'Post 1', slug: 'post-1', status: 'published' },
      ];
      (blogService.listBlogPosts as any).mockResolvedValue(mockPosts);

      const { result } = renderHook(() => useBlogPosts(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockPosts);
      expect(blogService.listBlogPosts).toHaveBeenCalledTimes(1);
    });

    it('should fetch blog posts with filters', async () => {
      const filters = { status: 'draft' as const, search: 'test' };
      (blogService.listBlogPosts as any).mockResolvedValue([]);

      renderHook(() => useBlogPosts(filters), { wrapper });

      expect(blogService.listBlogPosts).toHaveBeenCalledWith(filters);
    });
  });

  describe('useBlogPostById', () => {
    it('should fetch blog post by id', async () => {
      const mockPost = { id: '123', title: 'Test Post' };
      (blogService.getBlogPostById as any).mockResolvedValue(mockPost);

      const { result } = renderHook(() => useBlogPostById('123'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockPost);
      expect(blogService.getBlogPostById).toHaveBeenCalledWith('123');
    });

    it('should not fetch if id is missing', async () => {
      const { result } = renderHook(() => useBlogPostById(), { wrapper });
      expect(result.current.isLoading).toBe(false);
      expect(blogService.getBlogPostById).not.toHaveBeenCalled();
    });
  });

  describe('useBlogPostBySlug', () => {
    it('should fetch blog post by slug', async () => {
      const mockPost = { id: '123', slug: 'test-post' };
      (blogService.getBlogPostBySlug as any).mockResolvedValue(mockPost);

      const { result } = renderHook(() => useBlogPostBySlug('test-post'), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockPost);
      expect(blogService.getBlogPostBySlug).toHaveBeenCalledWith('test-post');
    });
  });

  describe('mutations', () => {
    it('useCreateBlogPost should call service and invalidate cache', async () => {
      const newPost = { id: 'new-1', title: 'New' };
      (blogService.createBlogPost as any).mockResolvedValue(newPost);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useCreateBlogPost(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ title: 'New', slug: 'new', content: '...', status: 'draft' });
      });

      expect(blogService.createBlogPost).toHaveBeenCalled();
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [BLOG_POSTS_QUERY_KEY] });
      expect(queryClient.getQueryData(['blog-post', 'id', 'new-1'])).toEqual(newPost);
    });

    it('useUpdateBlogPost should call service and invalidate cache', async () => {
      const updatedPost = { id: '1', title: 'Updated' };
      (blogService.updateBlogPost as any).mockResolvedValue(updatedPost);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateBlogPost('1'), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ title: 'Updated' });
      });

      expect(blogService.updateBlogPost).toHaveBeenCalledWith('1', { title: 'Updated' });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [BLOG_POSTS_QUERY_KEY] });
      expect(queryClient.getQueryData(['blog-post', 'id', '1'])).toEqual(updatedPost);
    });

    it('useDeleteBlogPost should call service and remove from cache', async () => {
      (blogService.deleteBlogPost as any).mockResolvedValue(undefined);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      const removeSpy = vi.spyOn(queryClient, 'removeQueries');

      const { result } = renderHook(() => useDeleteBlogPost(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync('1');
      });

      expect(blogService.deleteBlogPost).toHaveBeenCalledWith('1');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [BLOG_POSTS_QUERY_KEY] });
      expect(removeSpy).toHaveBeenCalledWith({ queryKey: ['blog-post', 'id', '1'], exact: true });
      expect(queryClient.getQueryData(['blog-post', 'id', '1'])).toBeUndefined();
    });

    it('useUpdateBlogPostById should call service and invalidate cache', async () => {
      const updatedPost = { id: '1', title: 'Updated Again' };
      (blogService.updateBlogPost as any).mockResolvedValue(updatedPost);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const { result } = renderHook(() => useUpdateBlogPostById(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ id: '1', input: { title: 'Updated Again' } });
      });

      expect(blogService.updateBlogPost).toHaveBeenCalledWith('1', { title: 'Updated Again' });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [BLOG_POSTS_QUERY_KEY] });
      expect(queryClient.getQueryData(['blog-post', 'id', '1'])).toEqual(updatedPost);
    });
  });
});
