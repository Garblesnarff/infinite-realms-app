/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useStarterCampaigns, useStarterCampaign } from '../use-starter-campaigns';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
    })),
  },
}));

const mockCampaigns = [
  {
    id: '1',
    slug: 'campaign-1',
    title: 'Campaign 1',
    tagline: 'Tagline 1',
    genre: ['Fantasy'],
    tone: ['Epic'],
    difficulty: 'Medium',
    level_range: '1-5',
    estimated_sessions: '5',
    premise: 'Premise 1',
    is_complete: true,
    is_published: true,
    is_featured: true,
    cover_image_url: 'cover-1.jpg',
    banner_image_url: 'banner-1.jpg',
  },
  {
    id: '2',
    slug: 'campaign-2',
    title: 'Campaign 2',
    tagline: 'Tagline 2',
    genre: null, // Test fallback
    tone: undefined, // Test fallback
    difficulty: 'Hard',
    level_range: '5-10',
    estimated_sessions: '10',
    premise: 'Premise 2',
    is_complete: true,
    is_published: true,
    is_featured: false,
    cover_image_url: 'cover-2.jpg',
    banner_image_url: 'banner-2.jpg',
  },
];

describe('useStarterCampaigns', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and map campaigns correctly', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: mockCampaigns, error: null }),
    });

    const { result } = renderHook(() => useStarterCampaigns());

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaigns).toHaveLength(2);
    expect(result.current.campaigns[0].title).toBe('Campaign 1');
    expect(result.current.campaigns[0].isFeatured).toBe(true);
    expect(result.current.campaigns[1].genre).toEqual([]);
    expect(result.current.campaigns[1].tone).toEqual([]);
    expect(result.current.featuredCampaigns).toHaveLength(1);
    expect(result.current.featuredCampaigns[0].id).toBe('1');
    expect(result.current.error).toBeNull();
  });

  it('should handle fetch errors', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: 'Fetch failed' } }),
    });

    const { result } = renderHook(() => useStarterCampaigns());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaigns).toHaveLength(0);
    expect(result.current.error?.message).toBe('Fetch failed');
  });

  it('should handle generic error objects', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockImplementation(() => {
        throw new Error('Generic error');
      }),
    });

    const { result } = renderHook(() => useStarterCampaigns());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error?.message).toBe('Generic error');
  });

  it('should handle non-Error exceptions', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockImplementation(() => {
        throw new Error('String error');
      }),
    });

    const { result } = renderHook(() => useStarterCampaigns());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error?.message).toBe('String error');
  });
});

describe('useStarterCampaign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null if no slug is provided', async () => {
    const { result } = renderHook(() => useStarterCampaign(undefined));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.campaign).toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('should fetch and map a single campaign by slug', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockCampaigns[0], error: null }),
    });

    const { result } = renderHook(() => useStarterCampaign('campaign-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaign?.slug).toBe('campaign-1');
    expect(result.current.campaign?.title).toBe('Campaign 1');
    expect(result.current.error).toBeNull();
  });

  it('should handle campaign not found (PGRST116)', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'Not found' } }),
    });

    const { result } = renderHook(() => useStarterCampaign('non-existent'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaign).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should handle other fetch errors', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Database error' } }),
    });

    const { result } = renderHook(() => useStarterCampaign('campaign-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.campaign).toBeNull();
    expect(result.current.error?.message).toBe('Database error');
  });

  it('should handle non-Error exceptions in single fetch', async () => {
    const mockFrom = vi.mocked(supabase.from);
    (mockFrom as any).mockReturnValue({
      select: vi.fn().mockImplementation(() => {
        throw new Error('String error');
      }),
    });

    const { result } = renderHook(() => useStarterCampaign('campaign-1'));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error?.message).toBe('String error');
  });
});
