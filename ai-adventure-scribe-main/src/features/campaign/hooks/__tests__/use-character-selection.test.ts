import { useQuery } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import {
  resolveStarterCampaignIdForCampaign,
  useCharacterSelection,
} from '../use-character-selection';

import type { Mock } from 'vitest';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Mocks
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    listSessions: vi.fn(),
    listStarterCharacterTemplates: vi.fn(),
    createCharacter: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

describe('useCharacterSelection', () => {
  const mockNavigate = vi.fn();
  const mockToast = vi.fn();
  const mockOnClose = vi.fn();
  const mockUser = { id: 'user-123' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (useNavigate as Mock).mockReturnValue(mockNavigate);
    (useToast as Mock).mockReturnValue({ toast: mockToast });
    (useAuth as Mock).mockReturnValue({ user: mockUser });

    // Default implementation for useQuery to avoid issues
    (useQuery as Mock).mockImplementation(({ queryKey }) => {
      if (queryKey.includes('starterLink')) return { data: null, isLoading: false };
      if (queryKey.includes('starterTemplates')) return { data: [], isLoading: false };
      if (queryKey.includes('characters')) return { data: [], isLoading: false };
      return { data: null, isLoading: false };
    });
  });

  describe('starter link resolution', () => {
    it('prefers the campaign-level link and does not query sessions', async () => {
      const getCampaign = vi.fn().mockResolvedValue({ starter_campaign_id: 'starter-campaign' });
      const listSessions = vi.fn();

      await expect(
        resolveStarterCampaignIdForCampaign('camp-1', { getCampaign, listSessions }),
      ).resolves.toBe('starter-campaign');
      expect(getCampaign).toHaveBeenCalledWith('camp-1');
      expect(listSessions).not.toHaveBeenCalled();
    });

    it('falls back to the session-derived link when the campaign row is empty', async () => {
      const getCampaign = vi.fn().mockResolvedValue({ starter_campaign_id: null });
      const listSessions = vi
        .fn()
        .mockResolvedValue([{ starter_campaign_id: 'starter-from-session' }]);

      await expect(
        resolveStarterCampaignIdForCampaign('camp-1', { getCampaign, listSessions }),
      ).resolves.toBe('starter-from-session');
      expect(listSessions).toHaveBeenCalledWith({
        campaignId: 'camp-1',
        starterOnly: true,
        limit: 1,
      });
    });

    it('returns no starter link when neither source has one', async () => {
      const getCampaign = vi.fn().mockResolvedValue({ starter_campaign_id: null });
      const listSessions = vi.fn().mockResolvedValue([]);

      await expect(
        resolveStarterCampaignIdForCampaign('camp-1', { getCampaign, listSessions }),
      ).resolves.toBeNull();
    });
  });

  it('initializes correctly', () => {
    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    expect(result.current.isCreating).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('surfaces starter-link failures and retries that lookup before loading characters', () => {
    const starterError = new Error('Malformed session list');
    const refetchStarterLink = vi.fn();
    let charactersEnabled: boolean | undefined;

    (useQuery as Mock).mockImplementation(({ queryKey, enabled }) => {
      if (queryKey.includes('starterLink')) {
        return {
          data: undefined,
          isLoading: false,
          error: starterError,
          refetch: refetchStarterLink,
        };
      }
      if (queryKey.includes('starterTemplates')) {
        return { data: [], isLoading: false, error: null, refetch: vi.fn() };
      }
      if (queryKey.includes('characters')) {
        charactersEnabled = enabled;
        return { data: [], isLoading: false, error: null, refetch: vi.fn() };
      }
      return { data: null, isLoading: false, error: null, refetch: vi.fn() };
    });

    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    expect(result.current.loadError).toBe(starterError);
    expect(charactersEnabled).toBe(false);

    act(() => result.current.retryLoad());
    expect(refetchStarterLink).toHaveBeenCalledOnce();
  });

  it('handles handleCreateCharacter', () => {
    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    act(() => {
      result.current.handleCreateCharacter();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/app/characters/create?campaign=camp-1');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles startGameWithCharacter', () => {
    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    const mockCharacter = {
      id: 'char-1',
      name: 'Grog',
      race: 'Half-Orc',
      class: 'Barbarian',
      level: 1,
    };

    act(() => {
      result.current.startGameWithCharacter(mockCharacter);
    });

    expect(mockOnClose).toHaveBeenCalled();
    // Since navigate is in a setTimeout(0)
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/app/game/camp-1?character=char-1&new=true');
  });
});
