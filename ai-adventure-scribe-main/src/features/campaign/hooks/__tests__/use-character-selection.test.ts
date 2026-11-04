import { useQuery } from '@tanstack/react-query';
import { renderHook, act, type RenderHookResult } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import {
  useCharacterSelection,
  type UseCharacterSelectionReturn,
} from '../use-character-selection';

import type { Mock } from 'vitest';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { userDataApi } from '@/services/user-data-api';

// Mocks
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
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

vi.mock('@/services/character/starter-character-seeding', () => ({
  seedStarterCharacter: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createCharacter: vi.fn(),
    listCharacters: vi.fn(),
    listSessions: vi.fn(),
  },
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
    (userDataApi.listSessions as Mock).mockResolvedValue([]);
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

  it('handles startGameWithCharacter', async () => {
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

    const { userDataApi } = await import('@/services/user-data-api');
    (userDataApi.listSessions as Mock).mockResolvedValue([]);

    await act(async () => {
      await result.current.startGameWithCharacter(mockCharacter);
    });

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/app/game/camp-1?character=char-1&new=true');
  });

  it('#1380: startGameWithCharacter resumes an active session instead of forcing new', async () => {
    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    const { userDataApi } = await import('@/services/user-data-api');
    (userDataApi.listSessions as Mock).mockResolvedValue([
      { id: 'sess-live', session_number: 2, status: 'active' },
      { id: 'sess-1', session_number: 1, status: 'completed' },
    ]);

    await act(async () => {
      await result.current.startGameWithCharacter({
        id: 'char-1',
        name: 'Grog',
        race: 'Half-Orc',
        class: 'Barbarian',
        level: 1,
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      '/app/game/camp-1?character=char-1&session=sess-live',
    );
  });

  it('#1380: startGameWithCharacter continues a completed playthrough through the game route', async () => {
    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    const { userDataApi } = await import('@/services/user-data-api');
    (userDataApi.listSessions as Mock).mockResolvedValue([
      {
        id: 'sess-2',
        session_number: 2,
        status: 'completed',
        starter_campaign_id: 'starter-last-bout',
      },
    ]);

    await act(async () => {
      await result.current.startGameWithCharacter({
        id: 'char-1',
        name: 'Grog',
        race: 'Half-Orc',
        class: 'Barbarian',
        level: 1,
      });
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      '/app/game/camp-1?character=char-1&starterCampaign=starter-last-bout',
    );
  });

  it('#1380: startGameWithCharacter fails closed on a session-list error', async () => {
    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    const { userDataApi } = await import('@/services/user-data-api');
    (userDataApi.listSessions as Mock).mockRejectedValue(new Error('list down'));

    await act(async () => {
      await result.current.startGameWithCharacter({
        id: 'char-1',
        name: 'Grog',
        race: 'Half-Orc',
        class: 'Barbarian',
        level: 1,
      });
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error', variant: 'destructive' }),
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('#209: two fast picks of the same template create only one character', async () => {
    const { seedStarterCharacter } = await import('@/services/character/starter-character-seeding');
    const { userDataApi } = await import('@/services/user-data-api');
    (userDataApi.createCharacter as Mock).mockResolvedValue({ id: 'char-new-1' });
    (seedStarterCharacter as Mock).mockImplementation(
      async (
        _template: unknown,
        _campaignId: string,
        create: (payload: unknown) => Promise<unknown>,
      ) => create({ name: 'The Scholar' }),
    );

    const { result } = renderHook(() =>
      useCharacterSelection({
        campaignId: 'camp-1',
        campaignName: 'Campaign 1',
        onClose: mockOnClose,
        isOpen: true,
      }),
    );

    // Two picks in the same tick, before any re-render flips isCreating: without
    // the synchronous ref guard both would read isCreating=false and create twice.
    const template = { id: 'tpl-scholar', name: 'The Scholar' } as never;
    let first: Promise<void>;
    let second: Promise<void>;
    act(() => {
      first = result.current.handleSelectTemplate(template);
      second = result.current.handleSelectTemplate(template);
    });
    await act(async () => {
      await Promise.all([first, second]);
    });

    expect(seedStarterCharacter).toHaveBeenCalledTimes(1);
    expect(userDataApi.createCharacter).toHaveBeenCalledTimes(1);
  });

  describe('#1380 template picks', () => {
    const mockStarterLink = (starterCampaignId: string | null): void => {
      (useQuery as Mock).mockImplementation(({ queryKey }) => {
        if (queryKey.includes('starterLink')) {
          return { data: starterCampaignId, isLoading: false, error: null, refetch: vi.fn() };
        }
        if (queryKey.includes('starterTemplates')) {
          return { data: [], isLoading: false, error: null, refetch: vi.fn() };
        }
        if (queryKey.includes('characters')) {
          return { data: [], isLoading: false, error: null, refetch: vi.fn() };
        }
        return { data: null, isLoading: false, error: null, refetch: vi.fn() };
      });
    };

    const scholarSession = (over: Record<string, unknown>): Record<string, unknown> => ({
      starter_campaign_id: 'starter-1',
      status: 'completed',
      session_number: 1,
      updated_at: '2026-11-01T10:00:00Z',
      character: { name: 'The Scholar' },
      ...over,
    });

    const renderSelection = (): RenderHookResult<UseCharacterSelectionReturn, unknown> =>
      renderHook(() =>
        useCharacterSelection({
          campaignId: 'camp-1',
          campaignName: 'Campaign 1',
          onClose: mockOnClose,
          isOpen: true,
        }),
      );

    const template = { id: 'tpl-scholar', name: 'The Scholar' } as never;

    it('two saved playthroughs for the hero name open the picker and seed nothing', async () => {
      mockStarterLink('starter-1');
      (userDataApi.listSessions as Mock).mockResolvedValue([
        scholarSession({
          id: 's-a2',
          session_number: 2,
          status: 'active',
          character_id: 'char-esme-a',
          updated_at: '2026-11-03T10:00:00Z',
        }),
        scholarSession({
          id: 's-a1',
          character_id: 'char-esme-a',
          updated_at: '2026-11-02T10:00:00Z',
        }),
        scholarSession({ id: 's-b1', character_id: 'char-esme-b' }),
      ]);
      const { seedStarterCharacter } =
        await import('@/services/character/starter-character-seeding');

      const { result } = renderSelection();

      await act(async () => {
        await result.current.handleSelectTemplate(template);
      });

      expect(result.current.playthroughChoices).toHaveLength(2);
      expect(seedStarterCharacter).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('one saved playthrough continues that character without seeding', async () => {
      mockStarterLink('starter-1');
      (userDataApi.listSessions as Mock).mockResolvedValue([
        scholarSession({ id: 's-a1', character_id: 'char-esme-a' }),
      ]);
      const { seedStarterCharacter } =
        await import('@/services/character/starter-character-seeding');

      const { result } = renderSelection();

      await act(async () => {
        await result.current.handleSelectTemplate(template);
      });

      expect(seedStarterCharacter).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-esme-a&starterCampaign=starter-1',
      );
    });

    it('choosing a picker row continues that character and clears the picker', async () => {
      mockStarterLink('starter-1');
      (userDataApi.listSessions as Mock).mockResolvedValue([
        scholarSession({
          id: 's-a2',
          session_number: 2,
          status: 'active',
          character_id: 'char-esme-a',
          updated_at: '2026-11-03T10:00:00Z',
        }),
        scholarSession({ id: 's-b1', character_id: 'char-esme-b' }),
      ]);

      const { result } = renderSelection();

      await act(async () => {
        await result.current.handleSelectTemplate(template);
      });
      const choices = result.current.playthroughChoices;
      expect(choices).toHaveLength(2);
      if (!choices) throw new Error('expected playthrough choices');

      act(() => {
        result.current.choosePlaythrough(choices[0]);
      });

      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-esme-a&starterCampaign=starter-1',
      );
      expect(result.current.playthroughChoices).toBeNull();
    });

    it('a session-list failure seeds nothing and toasts', async () => {
      mockStarterLink('starter-1');
      (userDataApi.listSessions as Mock).mockRejectedValue(new Error('list down'));
      const { seedStarterCharacter } =
        await import('@/services/character/starter-character-seeding');

      const { result } = renderSelection();

      await act(async () => {
        await result.current.handleSelectTemplate(template);
      });

      expect(seedStarterCharacter).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Error', variant: 'destructive' }),
      );
    });

    it('one saved ACTIVE playthrough continues that character without seeding', async () => {
      mockStarterLink('starter-1');
      (userDataApi.listSessions as Mock).mockResolvedValue([
        scholarSession({
          id: 's-a2',
          session_number: 2,
          status: 'active',
          character_id: 'char-esme-a',
          updated_at: '2026-11-03T10:00:00Z',
        }),
      ]);
      const { seedStarterCharacter } =
        await import('@/services/character/starter-character-seeding');

      const { result } = renderSelection();

      await act(async () => {
        await result.current.handleSelectTemplate(template);
      });

      expect(seedStarterCharacter).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-esme-a&starterCampaign=starter-1',
      );
    });

    it('no saved playthrough seeds and starts fresh with new=true', async () => {
      mockStarterLink('starter-1');
      (userDataApi.listSessions as Mock).mockResolvedValue([]);
      const { seedStarterCharacter } =
        await import('@/services/character/starter-character-seeding');
      (seedStarterCharacter as Mock).mockImplementation(
        async (
          _template: unknown,
          _campaignId: string,
          create: (payload: unknown) => Promise<unknown>,
        ) => create({ name: 'The Scholar' }),
      );
      (userDataApi.createCharacter as Mock).mockResolvedValue({ id: 'char-new-1' });

      const { result } = renderSelection();

      await act(async () => {
        await result.current.handleSelectTemplate(template);
      });
      act(() => {
        vi.advanceTimersByTime(0);
      });

      expect(seedStarterCharacter).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith(
        '/app/game/camp-1?character=char-new-1&starterCampaign=starter-1&new=true',
      );
    });
  });
});
