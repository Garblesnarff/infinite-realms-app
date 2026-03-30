/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor, act } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  useBlogMedia,
  useUploadBlogMedia,
  useDeleteBlogMedia,
  BLOG_MEDIA_QUERY_KEY,
} from '../useBlogMedia';

import * as blogMediaService from '@/services/blog/blog-media-service';

// Mock the blog media service
vi.mock('@/services/blog/blog-media-service', () => ({
  BLOG_MEDIA_BUCKET: 'blog-media',
  BLOG_MEDIA_PREFIX: 'uploads',
  listBlogMedia: vi.fn(),
  requestSignedUpload: vi.fn(),
  uploadWithSignedUrl: vi.fn(),
  deleteBlogMedia: vi.fn(),
  buildMediaPublicUrl: vi.fn((path, bucket) => `https://public.url/${bucket}/${path}`),
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

describe('useBlogMedia hooks', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
  });

  const wrapper = ({ children }: { children: React.ReactNode }): JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe('useBlogMedia', () => {
    it('should fetch blog media', async () => {
      const mockAssets = [
        { id: '1', path: 'uploads/1.png', bucket: 'blog-media', name: '1.png' },
      ];
      (blogMediaService.listBlogMedia as any).mockResolvedValue(mockAssets);

      const { result } = renderHook(() => useBlogMedia(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.data).toEqual(mockAssets);
      expect(blogMediaService.listBlogMedia).toHaveBeenCalledWith('uploads', 'blog-media');
    });
  });

  describe('useUploadBlogMedia', () => {
    it('should upload media and update cache', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      const signedResponse = {
        signedUrl: 'https://signed.url',
        path: 'uploads/test.png',
        bucket: 'blog-media'
      };

      (blogMediaService.requestSignedUpload as any).mockResolvedValue(signedResponse);
      (blogMediaService.uploadWithSignedUrl as any).mockResolvedValue(undefined);

      const { result } = renderHook(() => useUploadBlogMedia(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ file });
      });

      expect(blogMediaService.requestSignedUpload).toHaveBeenCalled();
      expect(blogMediaService.uploadWithSignedUrl).toHaveBeenCalledWith('https://signed.url', file, 'image/png');

      const cachedData = queryClient.getQueryData([BLOG_MEDIA_QUERY_KEY, 'blog-media', 'uploads']);
      expect(cachedData).toBeDefined();
      expect((cachedData as any)[0].name).toBe('test.png');
    });

    it('should handle Blob upload with default filename', async () => {
      const blob = new Blob([''], { type: 'application/pdf' });
      const signedResponse = {
        signedUrl: 'https://signed.url',
        path: 'uploads/asset-123',
        bucket: 'blog-media'
      };

      (blogMediaService.requestSignedUpload as any).mockResolvedValue(signedResponse);
      (blogMediaService.uploadWithSignedUrl as any).mockResolvedValue(undefined);

      // Mock Date.now() for deterministic filename
      const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123);

      const { result } = renderHook(() => useUploadBlogMedia(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ file: blob });
      });

      expect((blogMediaService.requestSignedUpload as any).mock.calls[0][0].filename).toBe('uploads/asset-123');

      nowSpy.mockRestore();
    });

    it('should use custom prefix and bucket if provided', async () => {
      const file = new File([''], 'test.png', { type: 'image/png' });
      const signedResponse = {
        signedUrl: 'https://signed.url',
        path: 'custom-prefix/test.png',
        bucket: 'custom-bucket'
      };

      (blogMediaService.requestSignedUpload as any).mockResolvedValue(signedResponse);

      const { result } = renderHook(() => useUploadBlogMedia(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({
          file,
          bucket: 'custom-bucket',
          prefix: 'custom-prefix',
          filename: 'custom.png',
          contentType: 'image/jpeg'
        });
      });

      expect(blogMediaService.requestSignedUpload).toHaveBeenCalledWith({
        filename: 'custom-prefix/custom.png',
        contentType: 'image/jpeg',
        bucket: 'custom-bucket',
      });
    });
  });

  describe('useDeleteBlogMedia', () => {
    it('should delete media and optimistically update cache', async () => {
      const initialAssets = [
        { id: 'uploads/1.png', path: 'uploads/1.png', bucket: 'blog-media', name: '1.png' },
      ];
      queryClient.setQueryData([BLOG_MEDIA_QUERY_KEY, 'blog-media', 'uploads'], initialAssets);

      (blogMediaService.deleteBlogMedia as any).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteBlogMedia(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ path: 'uploads/1.png' });
      });

      expect(blogMediaService.deleteBlogMedia).toHaveBeenCalledWith('uploads/1.png', 'blog-media');
      const cachedData = queryClient.getQueryData([BLOG_MEDIA_QUERY_KEY, 'blog-media', 'uploads']);
      expect(cachedData).toEqual([]);
    });

    it('should rollback cache on error', async () => {
      const initialAssets = [
        { id: 'uploads/1.png', path: 'uploads/1.png', bucket: 'blog-media', name: '1.png' },
      ];
      queryClient.setQueryData([BLOG_MEDIA_QUERY_KEY, 'blog-media', 'uploads'], initialAssets);

      (blogMediaService.deleteBlogMedia as any).mockRejectedValue(new Error('Delete failed'));

      const { result } = renderHook(() => useDeleteBlogMedia(), { wrapper });

      await act(async () => {
        try {
          await result.current.mutateAsync({ path: 'uploads/1.png' });
        } catch (_e) {
          // Expected
        }
      });

      const cachedData = queryClient.getQueryData([BLOG_MEDIA_QUERY_KEY, 'blog-media', 'uploads']);
      expect(cachedData).toEqual(initialAssets);
    });

    it('should use custom bucket for delete if provided', async () => {
      (blogMediaService.deleteBlogMedia as any).mockResolvedValue(undefined);

      const { result } = renderHook(() => useDeleteBlogMedia(), { wrapper });

      await act(async () => {
        await result.current.mutateAsync({ path: 'uploads/1.png', bucket: 'other-bucket' });
      });

      expect(blogMediaService.deleteBlogMedia).toHaveBeenCalledWith('uploads/1.png', 'other-bucket');
    });
  });
});
