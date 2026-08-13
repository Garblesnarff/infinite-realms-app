/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { listEntityImages } from '../gallery-service';

import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    storage: {
      from: vi.fn(() => ({
        list: vi.fn(),
        getPublicUrl: vi.fn(),
      })),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('GalleryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listEntityImages', () => {
    const entityType = 'campaign';
    const entityId = 'test-campaign-id';

    it('should list images and format them correctly', async () => {
      const mockFiles = [
        { name: '1700000000-dragon.png', created_at: '2023-11-15T10:00:00Z' },
        { name: '1700000001-tavern.png', updated_at: '2023-11-15T11:00:00Z' },
      ];

      const mockList = vi.fn().mockResolvedValue({ data: mockFiles, error: null });
      const mockGetPublicUrl = vi.fn((path) => ({
        data: { publicUrl: `https://test.com/${path}` },
      }));

      (supabase.storage.from as any).mockReturnValue({
        list: mockList,
        getPublicUrl: mockGetPublicUrl,
      });

      const result = await listEntityImages(entityType, entityId);

      expect(supabase.storage.from).toHaveBeenCalledWith('campaign-images');
      expect(mockList).toHaveBeenCalledWith('campaigns/test-campaign-id', {
        limit: 100,
        offset: 0,
      });

      expect(result).toHaveLength(2);
      // Newest first sorting based on createdAt
      expect(result[0].name).toBe('1700000001-tavern.png');
      expect(result[0].label).toBe('Tavern');
      expect(result[0].url).toBe(
        'https://test.com/campaigns/test-campaign-id/1700000001-tavern.png',
      );
      expect(result[0].createdAt).toBe('2023-11-15T11:00:00Z');

      expect(result[1].name).toBe('1700000000-dragon.png');
      expect(result[1].label).toBe('Dragon');
      expect(result[1].createdAt).toBe('2023-11-15T10:00:00Z');
    });

    it('should handle sorting when createdAt is missing', async () => {
      const mockFiles = [
        { name: 'image1.png', created_at: '2023-11-15T10:00:00Z' },
        { name: 'image2.png' },
      ];

      (supabase.storage.from as any).mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFiles, error: null }),
        getPublicUrl: vi.fn((path) => ({ data: { publicUrl: `https://test.com/${path}` } })),
      });

      const result = await listEntityImages(entityType, entityId);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('image1.png');
      expect(result[1].name).toBe('image2.png');
    });

    it('should handle missing data correctly', async () => {
      (supabase.storage.from as any).mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await listEntityImages(entityType, entityId);
      expect(result).toEqual([]);
    });

    it('should handle images with missing createdAt/updatedAt', async () => {
      const mockFiles = [{ name: '1700000000-dragon.png' }];

      (supabase.storage.from as any).mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFiles, error: null }),
        getPublicUrl: vi.fn((path) => ({ data: { publicUrl: `https://test.com/${path}` } })),
      });

      const result = await listEntityImages(entityType, entityId);
      expect(result).toHaveLength(1);
      expect(result[0].createdAt).toBeUndefined();
    });

    it('should filter out directories and handle various types', async () => {
      const mockFiles = [
        { name: 'image.png', created_at: '2023-11-15T10:00:00Z' },
        { name: 'some-dir/', created_at: '2023-11-15T10:00:00Z' },
        { name: null },
        { name: 123 },
        null,
      ];

      (supabase.storage.from as any).mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFiles, error: null }),
        getPublicUrl: vi.fn((path) => ({ data: { publicUrl: `https://test.com/${path}` } })),
      });

      const result = await listEntityImages(entityType, entityId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('image.png');
    });

    it('should handle Supabase errors gracefully', async () => {
      (supabase.storage.from as any).mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: null, error: { message: 'Supabase error' } }),
      });

      const result = await listEntityImages(entityType, entityId);

      expect(result).toEqual([]);
    });

    it('should handle exceptions gracefully', async () => {
      (supabase.storage.from as any).mockImplementation(() => {
        throw new Error('Unexpected exception');
      });

      const result = await listEntityImages(entityType, entityId);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should use default label when name does not match pattern', async () => {
      const mockFiles = [{ name: 'plain-filename.png', created_at: '2023-11-15T10:00:00Z' }];

      (supabase.storage.from as any).mockReturnValue({
        list: vi.fn().mockResolvedValue({ data: mockFiles, error: null }),
        getPublicUrl: vi.fn((path) => ({ data: { publicUrl: `https://test.com/${path}` } })),
      });

      const result = await listEntityImages(entityType, entityId);

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe(''); // Matches rawLabel = match?.[2] || ''
    });

    it('should support character entity type', async () => {
      const charId = 'char-123';
      const mockList = vi.fn().mockResolvedValue({ data: [], error: null });
      (supabase.storage.from as any).mockReturnValue({
        list: mockList,
        getPublicUrl: vi.fn(),
      });

      await listEntityImages('character', charId);

      expect(mockList).toHaveBeenCalledWith('characters/char-123', expect.anything());
    });
  });
});
