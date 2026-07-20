/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// useStarterCharacterTemplates/useStarterCharacterTemplate now fetch data through
// userDataApi (the Bun server's REST API client) instead of querying Supabase directly,
// so the mock target was updated to match. See
// src/hooks/use-starter-character-templates.ts. Note that userDataApi's methods return
// the array/object directly (no { data, error } wrapper), and neither method has any
// PGRST116 "not found" special-casing anymore - a missing row is just a falsy/empty
// result, not an error.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listStarterCharacterTemplates: vi.fn(),
    getStarterCharacterTemplate: vi.fn(),
  },
}));

import {
  useStarterCharacterTemplates,
  useStarterCharacterTemplate,
} from '../use-starter-character-templates';

import { userDataApi } from '@/services/user-data-api';

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

    vi.mocked(userDataApi.listStarterCharacterTemplates).mockResolvedValueOnce(mockData);

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

  it('should handle empty array from userDataApi', async () => {
    vi.mocked(userDataApi.listStarterCharacterTemplates).mockResolvedValueOnce([]);

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
    vi.mocked(userDataApi.listStarterCharacterTemplates).mockRejectedValueOnce(
      new Error('Database error'),
    );

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Database error');
    expect(result.current.templates).toEqual([]);
  });

  it('retries a failed template request', async () => {
    vi.mocked(userDataApi.listStarterCharacterTemplates)
      .mockRejectedValueOnce(new Error('Temporary error'))
      .mockResolvedValueOnce([]);

    const { result } = renderHook(() => useStarterCharacterTemplates(mockCampaignId));
    await waitFor(() => expect(result.current.error?.message).toBe('Temporary error'));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(userDataApi.listStarterCharacterTemplates).toHaveBeenCalledTimes(2);
  });

  it('should handle non-Error catch objects', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    vi.mocked(userDataApi.listStarterCharacterTemplates).mockRejectedValueOnce('string error');

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

    vi.mocked(userDataApi.listStarterCharacterTemplates).mockResolvedValueOnce(mockData);

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

    vi.mocked(userDataApi.getStarterCharacterTemplate).mockResolvedValueOnce(mockData);

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.template?.name).toBe('Legolas');
    expect(result.current.error).toBeNull();
  });

  it('should handle template not found', async () => {
    // getStarterCharacterTemplate() has no PGRST116/"not found" error concept anymore -
    // a missing template is just a null/undefined resolved value, not a thrown error. See
    // src/hooks/use-starter-character-templates.ts.
    vi.mocked(userDataApi.getStarterCharacterTemplate).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.template).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('should handle general fetch errors', async () => {
    vi.mocked(userDataApi.getStarterCharacterTemplate).mockRejectedValueOnce(
      new Error('Some other error'),
    );

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Some other error');
  });

  it('should handle Error catch objects in single fetch', async () => {
    vi.mocked(userDataApi.getStarterCharacterTemplate).mockRejectedValueOnce(
      new Error('Something went wrong'),
    );

    const { result } = renderHook(() => useStarterCharacterTemplate(mockTemplateId));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('Something went wrong');
  });

  it('should handle string throw in single fetch', async () => {
    // eslint-disable-next-line prefer-promise-reject-errors
    vi.mocked(userDataApi.getStarterCharacterTemplate).mockRejectedValueOnce('string error');

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
