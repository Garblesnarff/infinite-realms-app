/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  useBlogCategories,
  useCreateBlogCategory,
  useUpdateBlogCategory,
  useDeleteBlogCategory,
  useBlogTags,
  useCreateBlogTag,
  useUpdateBlogTag,
  useDeleteBlogTag,
  BLOG_CATEGORIES_QUERY_KEY
} from '../useBlogTaxonomy';

import * as blogTaxonomyService from '@/services/blog/blog-taxonomy-service';

// Mock the blog taxonomy service
vi.mock('@/services/blog/blog-taxonomy-service', () => ({
  listBlogCategories: vi.fn(),
  createBlogCategory: vi.fn(),
  updateBlogCategory: vi.fn(),
  deleteBlogCategory: vi.fn(),
  listBlogTags: vi.fn(),
  createBlogTag: vi.fn(),
  updateBlogTag: vi.fn(),
  deleteBlogTag: vi.fn(),
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

describe('useBlogTaxonomy', () => {
  let queryClient: QueryClient;
  const mockUUID = 'test-uuid-123';

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();

    // Mock crypto.randomUUID for deterministic optimistic IDs
    if (!globalThis.crypto) {
      (globalThis as any).crypto = {};
    }
    globalThis.crypto.randomUUID = vi.fn().mockReturnValue(mockUUID);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useBlogCategories', () => {
    it('should fetch blog categories', async () => {
      const mockCategories = [
        { id: '1', title: 'Category 1', slug: 'cat-1', createdAt: new Date().toISOString() },
      ];
      (blogTaxonomyService.listBlogCategories as any).mockResolvedValue(mockCategories);

      const { result } = renderHook(() => useBlogCategories(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockCategories);
      expect(blogTaxonomyService.listBlogCategories).toHaveBeenCalledTimes(1);
    });
  });

  describe('useCreateBlogCategory', () => {
    const input = { title: 'New Category', slug: 'new-category', description: 'Test desc' };
    const mockCreated = {
      id: 'real-id',
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: null
    };

    it('should successfully create a category and update cache', async () => {
      (blogTaxonomyService.createBlogCategory as any).mockResolvedValue(mockCreated);

      const { result } = renderHook(() => useCreateBlogCategory(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync(input);
      });

      expect(blogTaxonomyService.createBlogCategory).toHaveBeenCalledWith(input, expect.anything());

      // Check if cache was invalidated/updated
      const cached = queryClient.getQueryData([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached).toBeDefined();
    });

    it('should perform optimistic update', async () => {
      // Delay the response to test optimistic state
      let resolveMutation: (val: any) => void;
      const mutationPromise = new Promise((resolve) => {
        resolveMutation = resolve;
      });
      (blogTaxonomyService.createBlogCategory as any).mockReturnValue(mutationPromise);

      const { result } = renderHook(() => useCreateBlogCategory(), { wrapper });

      let mutatePromise: Promise<any>;
      await act(async () => {
        mutatePromise = result.current.mutateAsync(input);
      });

      // Check cache for optimistic entry
      const cached = queryClient.getQueryData<any[]>([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached).toHaveLength(1);
      expect(cached![0]).toMatchObject({
        id: mockUUID,
        title: input.title,
        slug: input.slug
      });

      // Resolve mutation
      await act(async () => {
        resolveMutation!(mockCreated);
        await mutatePromise!;
      });

      // Cache should be invalidated (refetched in real app, but here we just check settled)
      expect(blogTaxonomyService.createBlogCategory).toHaveBeenCalled();
    });

    it('should rollback cache on failure', async () => {
      const previousData = [{ id: 'old', title: 'Old', slug: 'old' }];
      queryClient.setQueryData([BLOG_CATEGORIES_QUERY_KEY], previousData);

      (blogTaxonomyService.createBlogCategory as any).mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useCreateBlogCategory(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync(input);
        } catch (_e) {
          // ignore
        }
      });

      // Cache should be rolled back to previousData
      const cached = queryClient.getQueryData([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached).toEqual(previousData);
    });
  });

  describe('useUpdateBlogCategory', () => {
    const categoryId = '1';
    const initialData = [
      { id: categoryId, title: 'Old Title', slug: 'old-slug', description: 'Old desc', createdAt: '...', updatedAt: null }
    ];
    const updateValues = { title: 'New Title' };

    it('should optimistically update a category', async () => {
      queryClient.setQueryData([BLOG_CATEGORIES_QUERY_KEY], initialData);

      let resolveMutation: (val: any) => void;
      const mutationPromise = new Promise((resolve) => {
        resolveMutation = resolve;
      });
      (blogTaxonomyService.updateBlogCategory as any).mockReturnValue(mutationPromise);

      const { result } = renderHook(() => useUpdateBlogCategory(), { wrapper });

      await act(async () => {
        result.current.mutate({ id: categoryId, values: updateValues });
      });

      // Check optimistic cache
      const cached = queryClient.getQueryData<any[]>([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached![0].title).toBe('New Title');
      expect(cached![0].updatedAt).toBeDefined();

      // Resolve
      await act(async () => {
        resolveMutation!({ ...initialData[0], ...updateValues, updatedAt: new Date().toISOString() });
      });
    });
  });

  describe('useBlogTags', () => {
    it('should fetch blog tags', async () => {
      const mockTags = [
        { id: '1', name: 'Tag 1', slug: 'tag-1', createdAt: new Date().toISOString() },
      ];
      (blogTaxonomyService.listBlogTags as any).mockResolvedValue(mockTags);

      const { result } = renderHook(() => useBlogTags(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockTags);
    });
  });

  describe('useCreateBlogTag', () => {
    const input = { name: 'New Tag', slug: 'new-tag', description: 'Test desc' };
    const mockCreated = { id: 'real-id', ...input, createdAt: new Date().toISOString(), updatedAt: null };

    it('should optimistically update tag cache', async () => {
      let resolveMutation: (val: any) => void;
      const mutationPromise = new Promise((resolve) => { resolveMutation = resolve; });
      (blogTaxonomyService.createBlogTag as any).mockReturnValue(mutationPromise);

      const { result } = renderHook(() => useCreateBlogTag(), { wrapper });

      await act(async () => {
        result.current.mutate(input);
      });

      const cached = queryClient.getQueryData<any[]>(['blog-tags']);
      expect(cached![0].name).toBe(input.name);

      await act(async () => {
        resolveMutation!(mockCreated);
      });
    });

    it('should rollback tag cache on failure', async () => {
      queryClient.setQueryData(['blog-tags'], []);
      (blogTaxonomyService.createBlogTag as any).mockRejectedValue(new Error('Failed'));

      const { result } = renderHook(() => useCreateBlogTag(), { wrapper });

      await act(async () => {
        try { await result.current.mutateAsync(input); } catch (_e) {
          // ignore
        }
      });

      expect(queryClient.getQueryData(['blog-tags'])).toEqual([]);
    });
  });

  describe('useUpdateBlogTag', () => {
    it('should optimistically update a tag', async () => {
      const initial = [{ id: '1', name: 'Old', slug: 'old' }];
      queryClient.setQueryData(['blog-tags'], initial);
      (blogTaxonomyService.updateBlogTag as any).mockResolvedValue({ ...initial[0], name: 'New' });

      const { result } = renderHook(() => useUpdateBlogTag(), { wrapper });

      await act(async () => {
        result.current.mutate({ id: '1', values: { name: 'New' } });
      });

      const cached = queryClient.getQueryData<any[]>(['blog-tags']);
      expect(cached![0].name).toBe('New');
    });
  });

  describe('useDeleteBlogTag', () => {
    it('should optimistically remove a tag', async () => {
      const initial = [{ id: '1', name: 'To Delete', slug: 'delete' }];
      queryClient.setQueryData(['blog-tags'], initial);
      (blogTaxonomyService.deleteBlogTag as any).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteBlogTag(), { wrapper });

      await act(async () => {
        result.current.mutate('1');
      });

      expect(queryClient.getQueryData<any[]>(['blog-tags'])).toHaveLength(0);
    });
  });

  describe('generateTempId fallback', () => {
    it('should fallback to Math.random if randomUUID is missing', async () => {
      const originalUUID = globalThis.crypto.randomUUID;
      (globalThis.crypto as any).randomUUID = undefined;

      const input = { title: 'Fallback 2', slug: 'fallback-2' };
      (blogTaxonomyService.createBlogCategory as any).mockResolvedValue({ id: '2', ...input });

      const { result } = renderHook(() => useCreateBlogCategory(), { wrapper });

      await act(async () => {
        result.current.mutate(input);
      });

      const cached = queryClient.getQueryData<any[]>([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached![0].id).toBeDefined();

      globalThis.crypto.randomUUID = originalUUID;
    });
  });

  describe('useUpdateBlogCategory branch coverage', () => {
    it('should handle optional fields in update', async () => {
      const id = '1';
      queryClient.setQueryData([BLOG_CATEGORIES_QUERY_KEY], [{ id, title: 'Old', slug: 'old', description: 'old' }]);
      (blogTaxonomyService.updateBlogCategory as any).mockResolvedValue({ id, title: 'New', slug: 'new', description: null });

      const { result } = renderHook(() => useUpdateBlogCategory(), { wrapper });

      await act(async () => {
        result.current.mutate({ id, values: { title: 'New', slug: 'new', description: null } });
      });

      const cached = queryClient.getQueryData<any[]>([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached![0]).toMatchObject({ title: 'New', slug: 'new', description: null });
    });

    it('should return empty array if cache is empty during update', async () => {
      queryClient.setQueryData([BLOG_CATEGORIES_QUERY_KEY], undefined);
      (blogTaxonomyService.updateBlogCategory as any).mockResolvedValue({ id: '1', title: 'New' });

      const { result } = renderHook(() => useUpdateBlogCategory(), { wrapper });

      await act(async () => {
        result.current.mutate({ id: '1', values: { title: 'New' } });
      });

      expect(queryClient.getQueryData([BLOG_CATEGORIES_QUERY_KEY])).toEqual([]);
    });
  });

  describe('useUpdateBlogTag branch coverage', () => {
    it('should handle optional fields in update', async () => {
      const id = '1';
      queryClient.setQueryData(['blog-tags'], [{ id, name: 'Old', slug: 'old', description: 'old' }]);
      (blogTaxonomyService.updateBlogTag as any).mockResolvedValue({ id, name: 'New', slug: 'new', description: null });

      const { result } = renderHook(() => useUpdateBlogTag(), { wrapper });

      await act(async () => {
        result.current.mutate({ id, values: { name: 'New', slug: 'new', description: null } });
      });

      const cached = queryClient.getQueryData<any[]>(['blog-tags']);
      expect(cached![0]).toMatchObject({ name: 'New', slug: 'new', description: null });
    });

    it('should return empty array if cache is empty during update', async () => {
      queryClient.setQueryData(['blog-tags'], undefined);
      (blogTaxonomyService.updateBlogTag as any).mockResolvedValue({ id: '1', name: 'New' });

      const { result } = renderHook(() => useUpdateBlogTag(), { wrapper });

      await act(async () => {
        result.current.mutate({ id: '1', values: { name: 'New' } });
      });

      expect(queryClient.getQueryData(['blog-tags'])).toEqual([]);
    });
  });

  describe('useDeleteBlogCategory', () => {
    const categoryId = '1';
    const initialData = [
      { id: categoryId, title: 'To Delete', slug: 'delete' },
      { id: '2', title: 'Keep', slug: 'keep' }
    ];

    it('should optimistically remove a category', async () => {
      queryClient.setQueryData([BLOG_CATEGORIES_QUERY_KEY], initialData);
      (blogTaxonomyService.deleteBlogCategory as any).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteBlogCategory(), { wrapper });

      await act(async () => {
        result.current.mutate(categoryId);
      });

      // Check optimistic cache
      const cached = queryClient.getQueryData<any[]>([BLOG_CATEGORIES_QUERY_KEY]);
      expect(cached).toHaveLength(1);
      expect(cached![0].id).toBe('2');
    });
  });
});
