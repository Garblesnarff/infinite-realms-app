/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useGameData } from '../useGameData';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { characterLoaderService } from '@/services/character-loader';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: vi.fn(),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

// useGameData now fetches the campaign via userDataApi.getCampaign() (a real fetch()
// to the Bun server, see src/features/game-session/components/game/useGameData.ts line 60)
// instead of supabase.from('campaigns')...single(), so the mock target was updated to
// match. userDataApi.getCampaign() resolves the campaign object directly (or throws on a
// non-ok response) rather than returning a {data,error} shape.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCampaign: vi.fn(),
    listCharacters: vi.fn(),
    listSessions: vi.fn(),
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
    (userDataApi.getCampaign as any).mockResolvedValue(mockCampaign);

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

  it('refreshes character HP and spell slots after an engine combat event', async () => {
    const initialCharacter = { id: 'char-1', name: 'Hero', currentHitPoints: 7, spellSlots: [2] };
    const engineUpdatedCharacter = {
      id: 'char-1',
      name: 'Hero',
      currentHitPoints: 5,
      spellSlots: [1],
    };
    (characterLoaderService.loadCharacterWithSpells as any)
      .mockResolvedValueOnce(initialCharacter)
      .mockResolvedValueOnce(engineUpdatedCharacter);
    (userDataApi.getCampaign as any).mockResolvedValue({ id: 'camp-1', user_id: 'user-1' });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      window.dispatchEvent(new CustomEvent('combat-state-updated'));
    });

    await waitFor(() =>
      expect(mockCharacterDispatch).toHaveBeenLastCalledWith({
        type: 'SET_CHARACTER',
        payload: engineUpdatedCharacter,
      }),
    );
    expect(characterLoaderService.loadCharacterWithSpells).toHaveBeenCalledTimes(2);
  });

  it('should handle missing IDs', async () => {
    const { result } = renderHook(() => useGameData(null, undefined));

    expect(result.current.missingTarget).toBe('no-adventure');
    expect(result.current.error).toBe(null);
    expect(result.current.isLoading).toBe(false);
  });

  describe('without a character id', () => {
    const characters = [
      { id: 'char-1', name: 'Aldric' },
      { id: 'char-2', name: 'Mira' },
    ];

    beforeEach(() => {
      (userDataApi.getCampaign as any).mockResolvedValue({ id: 'camp-1' });
      (userDataApi.listSessions as any).mockResolvedValue([]);
    });

    it('resolves the only character of the campaign', async () => {
      (userDataApi.listCharacters as any).mockResolvedValue([characters[0]]);

      const { result } = renderHook(() => useGameData(null, 'camp-1'));

      await waitFor(() => expect(result.current.resolvedCharacterId).toBe('char-1'));
      expect(userDataApi.listCharacters).toHaveBeenCalledWith('camp-1');
      expect(userDataApi.listSessions).not.toHaveBeenCalled();
      expect(result.current.error).toBe(null);
      expect(result.current.missingTarget).toBe(null);
    });

    it('resolves the character of the newest session when there are several', async () => {
      (userDataApi.listCharacters as any).mockResolvedValue(characters);
      (userDataApi.listSessions as any).mockResolvedValue([
        { id: 's-2', character_id: 'char-2' },
        { id: 's-1', character_id: 'char-1' },
      ]);

      const { result } = renderHook(() => useGameData(null, 'camp-1'));

      await waitFor(() => expect(result.current.resolvedCharacterId).toBe('char-2'));
      expect(userDataApi.listSessions).toHaveBeenCalledWith({ campaignId: 'camp-1', limit: 20 });
    });

    it('falls back to the newest character when no session matches', async () => {
      (userDataApi.listCharacters as any).mockResolvedValue(characters);

      const { result } = renderHook(() => useGameData(null, 'camp-1'));

      await waitFor(() => expect(result.current.resolvedCharacterId).toBe('char-1'));
    });

    it('reports no hero when the campaign has no character', async () => {
      (userDataApi.listCharacters as any).mockResolvedValue([]);

      const { result } = renderHook(() => useGameData(null, 'camp-1'));

      await waitFor(() => expect(result.current.missingTarget).toBe('no-hero'));
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBe(null);
    });

    it('reports no adventure when the campaign is not found', async () => {
      (userDataApi.getCampaign as any).mockRejectedValue(
        Object.assign(new Error('Not found (404)'), { status: 404 }),
      );

      const { result } = renderHook(() => useGameData(null, 'camp-1'));

      await waitFor(() => expect(result.current.missingTarget).toBe('no-adventure'));
      expect(userDataApi.listCharacters).not.toHaveBeenCalled();
    });

    it('clears the missing-hero state once a character id is in the URL', async () => {
      (userDataApi.listCharacters as any).mockResolvedValue([]);
      (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({ id: 'char-1' });

      const { result, rerender } = renderHook(
        ({ characterId }: { characterId: string | null }) => useGameData(characterId, 'camp-1'),
        { initialProps: { characterId: null as string | null } },
      );
      await waitFor(() => expect(result.current.missingTarget).toBe('no-hero'));

      rerender({ characterId: 'char-1' });

      await waitFor(() => expect(result.current.missingTarget).toBe(null));
      await waitFor(() => expect(result.current.isLoading).toBe(false));
    });

    it('shows a plain message, not developer text, when the lookup fails', async () => {
      (userDataApi.listCharacters as any).mockRejectedValue(new Error('boom'));

      const { result } = renderHook(() => useGameData(null, 'camp-1'));

      await waitFor(() => expect(result.current.error).not.toBe(null));
      expect(result.current.error).toBe('We could not load your hero. Please try again.');
      expect(result.current.missingTarget).toBe(null);
    });
  });

  it('should handle character load failure', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(null);
    (userDataApi.getCampaign as any).mockResolvedValue({ id: 'camp-1' });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Character not found or failed to load.');
  });

  it('should handle campaign load failure', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({ id: 'char-1' });
    // userDataApi.getCampaign() rethrows the server error verbatim (see request() in
    // src/services/user-data-api.ts) rather than returning a {data,error} shape, and
    // useGameData no longer wraps it with a "Failed to load campaign: ..." prefix - it
    // just surfaces err.message directly (useGameData.ts line 98).
    (userDataApi.getCampaign as any).mockRejectedValue(new Error('DB Error'));

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('DB Error');
  });

  it('should handle campaign not found (no error, no data)', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({ id: 'char-1' });
    (userDataApi.getCampaign as any).mockResolvedValue(null);

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Campaign not found.');
  });

  it('should identify user as not DM if they are not the owner', async () => {
    const mockCharacter = { id: 'char-1' };
    const mockCampaign = { id: 'camp-1', user_id: 'other-user' };

    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(mockCharacter);
    (userDataApi.getCampaign as any).mockResolvedValue(mockCampaign);

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isDM).toBe(false);
  });

  it('should force DM role if VITE_FORCE_DM is true', async () => {
    vi.stubEnv('VITE_FORCE_DM', 'true');

    const mockCharacter = { id: 'char-1' };
    const mockCampaign = { id: 'camp-1', user_id: 'other-user' };

    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue(mockCharacter);
    (userDataApi.getCampaign as any).mockResolvedValue(mockCampaign);

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.isDM).toBe(true);
  });

  it('should handle general error during load', async () => {
    (characterLoaderService.loadCharacterWithSpells as any).mockRejectedValue(
      new Error('Unknown Error'),
    );
    (userDataApi.getCampaign as any).mockResolvedValue({ id: 'camp-1' });

    const { result } = renderHook(() => useGameData('char-1', 'camp-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Unknown Error');
  });
});
