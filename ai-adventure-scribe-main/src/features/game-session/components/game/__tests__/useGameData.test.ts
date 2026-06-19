/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useGameData } from '../useGameData';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { supabase } from '@/integrations/supabase/client';
import { characterLoaderService } from '@/services/character-loader';
import logger from '@/lib/logger';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: vi.fn(),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

vi.mock('@/services/character-loader', () => ({
  characterLoaderService: {
    loadCharacterWithSpells: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/error-handler', () => ({
  handleAsyncError: vi.fn(),
}));

describe('useGameData', () => {
  const mockCharacterDispatch = vi.fn();
  const mockCampaignDispatch = vi.fn();
  const mockUser = { id: 'user-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ user: mockUser });
    (useCharacter as any).mockReturnValue({ dispatch: mockCharacterDispatch });
    (useCampaign as any).mockReturnValue({ dispatch: mockCampaignDispatch });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should load data successfully and dispatch to contexts', async () => {
    const mockCharacter = { id: 'char-1', name: 'Hero' };
    const mockCampaign = { id: 'camp-1', name: 'Adventure', user_id: 'user-1' };

    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(mockCharacter);
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    expect(result.current.isLoading).toBe(true);
    expect(result.current.loadingPhase).toBe('data');

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockCharacterDispatch).toHaveBeenCalledWith({
      type: 'SET_CHARACTER',
      payload: mockCharacter,
    });
    expect(mockCampaignDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CAMPAIGN',
      payload: mockCampaign,
    });
    expect(result.current.isDM).toBe(true);
    expect(result.current.error).toBe(null);
    expect(result.current.loadingPhase).toBe('greeting');
  });

  it('should handle missing IDs', async () => {
    const { result } = renderHook(() => useGameData(null, undefined));

    expect(result.current.error).toBe('Character ID or Campaign ID is missing from URL parameters.');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle character load failure', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(null);
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'camp-1' }, error: null }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Character not found or failed to load.');
  });

  it('should handle campaign load failure', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({ id: 'char-1' });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Failed to load campaign: DB Error');
  });

  it('should handle campaign not found (no error, no data)', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({ id: 'char-1' });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Campaign not found.');
  });

  it('should identify user as not DM if they are not the owner', async () => {
    const mockCharacter = { id: 'char-1' };
    const mockCampaign = { id: 'camp-1', user_id: 'other-user' };

    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(mockCharacter);
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isDM).toBe(false);
  });

  it('should force DM role if VITE_FORCE_DM is true', async () => {
    vi.stubEnv('VITE_FORCE_DM', 'true');

    const mockCharacter = { id: 'char-1' };
    const mockCampaign = { id: 'camp-1', user_id: 'other-user' };

    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(mockCharacter);
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: mockCampaign, error: null }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isDM).toBe(true);
  });

  it('should handle general error during load', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockRejectedValue(new Error('Unknown Error'));
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'camp-1' }, error: null }),
    });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Unknown Error');
  });
});
