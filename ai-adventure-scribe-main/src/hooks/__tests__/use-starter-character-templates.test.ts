/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

import { useStarterCharacterTemplates, useStarterCharacterTemplate } from '../use-starter-character-templates';

import { supabase } from '@/integrations/supabase/client';

describe('useStarterCharacterTemplates', () => {
  const mockCampaignId = 'campaign-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch and map templates successfully', async () => {
    const mockData = [
      {
        id: '1',
        starter_campaign_id: mockCampaignId,
        template_key: 'fighter',
        name: 'Aragorn',
        tagline: 'Strider',
        race: 'Human',
        subrace: null,
        class: 'Fighter',
        background: 'Noble',
        level: 1,
        ability_scores: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 14 },
        personality: { traits: ['Brave'], ideals: ['Justice'], bonds: ['The Kingdom'], flaws: ['None'] },
        skills: ['Athletics'],
        languages: ['Common'],
        equipment: ['Sword'],
        adapted_backstory: 'A ranger from the north.',
        campaign_hook: 'You meet in a tavern.',
        portrait_url: 'http://example.com/aragorn.jpg',
        portrait_prompt: 'A heroic human fighter.',
        display_order: 1,
      },
    ];

    const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: mockOrder,
    });

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.templates).toHaveLength(1);
    const template = result.current.templates[0];
    expect(template.name).toBe('Aragorn');
    expect(template.abilityScores.strength).toBe(16);
    expect(template.personality.traits).toEqual(['Brave']);
    expect(result.current.error).toBeNull();
  });

  it('should handle empty data from supabase', async () => {
    const mockOrder = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: mockOrder,
    });

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.templates).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('should handle empty campaignId', () => {
    const { result } = renderHook(() => useStarterCharacterTemplates(undefined));
    expect(result.current.templates).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle fetch errors', async () => {
    const mockError = { message: 'Database error' };
    const mockOrder = vi.fn().mockResolvedValue({ data: null, error: mockError });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: mockOrder,
    });

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Database error');
    expect(result.current.templates).toEqual([]);
  });

  it('should handle non-Error catch objects', async () => {
    const mockOrder = vi.fn().mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error';
    });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: mockOrder,
    });

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Failed to fetch character templates');
  });

  it('should provide default values for missing data', async () => {
     const mockData = [
      {
        id: '2',
        starter_campaign_id: mockCampaignId,
        template_key: 'rogue',
        name: 'Bilbo',
        race: 'Hobbit',
        class: 'Rogue',
        ability_scores: null,
        personality: null,
      },
    ];

    const mockOrder = vi.fn().mockResolvedValue({ data: mockData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: mockOrder,
    });

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const template = result.current.templates[0];
    expect(template.abilityScores.strength).toBe(10);
    expect(template.personality.traits).toEqual([]);
    expect(template.level).toBe(1);
  });
});

describe('useStarterCharacterTemplate', () => {
  const mockTemplateId = 'template-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fetch single template successfully', async () => {
    const mockData = {
      id: mockTemplateId,
      name: 'Legolas',
      race: 'Elf',
      class: 'Ranger',
    };

    const mockSingle = vi.fn().mockResolvedValue({ data: mockData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.template?.name).toBe('Legolas');
    expect(result.current.error).toBeNull();
  });

  it('should handle template not found (PGRST116)', async () => {
    const mockError = { code: 'PGRST116', message: 'Not found' };
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.template).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should handle general fetch errors', async () => {
    const mockError = { message: 'Some other error' };
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Some other error');
  });

  it('should handle non-Error catch objects in single fetch', async () => {
    const mockSingle = vi.fn().mockImplementation(() => {
      throw new Error('Something went wrong');
    });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Something went wrong');
  });

  it('should handle string throw in single fetch', async () => {
    const mockSingle = vi.fn().mockImplementation(() => {
      // eslint-disable-next-line no-throw-literal
      throw 'string error';
    });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    });

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Failed to fetch character template');
  });

  it('should handle undefined templateId', () => {
    const { result } = renderHook(() => useStarterCharacterTemplate(undefined));
    expect(result.current.template).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});
