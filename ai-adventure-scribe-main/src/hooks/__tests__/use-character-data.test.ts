/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacter: vi.fn(),
  },
}));

vi.mock('@/services/issue-1784-api', () => ({
  issue1784Api: {
    getCharacterEquipment: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

// Mock react-router-dom
const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/utils/validation', () => ({
  isValidUUID: vi.fn(),
}));

vi.mock('@/lib/logger', () => {
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
  // data-transformers imports the default export.
  return { logger, default: logger };
});

// Use the same path as in the source file for mocking sensitivity
vi.mock('../lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { useCharacterData } from '../use-character-data';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';
import { userDataApi } from '@/services/user-data-api';
import { isValidUUID } from '@/utils/validation';

describe('useCharacterData', () => {
  const mockUserId = 'user-123';
  const mockCharacterId = '550e8400-e29b-41d4-a716-446655440000'; // Valid v4 UUID
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useAuth as any).mockReturnValue({ user: { id: mockUserId } });
    (useToast as any).mockReturnValue({ toast: mockToast });
    (isValidUUID as any).mockReturnValue(true);
    vi.mocked(issue1784Api.getCharacterEquipment).mockResolvedValue([]);
  });

  it('should fetch and transform character data successfully', async () => {
    const mockCharacterData = {
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'Test Hero',
      race: 'Human',
      class: 'Fighter',
      level: 1,
      cantrips: 'mage-hand, light',
      known_spells: 'magic-missile, shield',
      prepared_spells: 'shield',
      ritual_spells: 'detect-magic',
      character_stats: {
        strength: 15,
        dexterity: 14,
        constitution: 13,
        intelligence: 12,
        wisdom: 10,
        charisma: 8,
      },
      character_equipment: [{ item_name: 'Longsword', id: 'item-1', quantity: 1, equipped: true }],
    };

    vi.mocked(userDataApi.getCharacter).mockResolvedValue(mockCharacterData);
    vi.mocked(issue1784Api.getCharacterEquipment).mockResolvedValue([
      { item_name: 'Longsword', id: 'item-1', quantity: 1, equipped: true } as any,
    ]);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.character).not.toBeNull();
    expect(result.current.character?.name).toBe('Test Hero');
    expect(result.current.character?.abilityScores!.strength.score).toBe(15);
    expect(result.current.character?.abilityScores!.strength.modifier).toBe(2);
    expect(result.current.character?.cantrips).toEqual(['mage-hand', 'light']);
    expect(result.current.character?.knownSpells).toEqual(['magic-missile', 'shield']);
    expect(result.current.character?.equipment).toContain('Longsword');
    expect(result.current.character?.inventory![0].itemId).toBe('item-1');
    expect(result.current.character?.inventory![0].equipped).toBe(true);

    expect(userDataApi.getCharacter).toHaveBeenCalledWith(mockCharacterId);
    expect(issue1784Api.getCharacterEquipment).toHaveBeenCalledWith(mockCharacterId);
    expect(result.current.equipmentUnavailable).toBe(false);
  });

  it('should handle invalid character ID UUID', async () => {
    (isValidUUID as any).mockReturnValue(false);

    renderHook(() => useCharacterData('invalid-uuid'));

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Invalid Character',
        variant: 'destructive',
      }),
    );
    expect(mockNavigate).toHaveBeenCalledWith('/app/characters');
  });

  it('should handle unauthenticated user', async () => {
    (useAuth as any).mockReturnValue({ user: null });

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Not Authenticated',
      }),
    );
  });

  it('should handle character not found or unauthorized', async () => {
    vi.mocked(userDataApi.getCharacter).mockResolvedValue(null);

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/characters'));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Character Not Found',
      }),
    );
  });

  it('should handle database errors', async () => {
    // userDataApi.getCharacter() throws (rather than returning a {data,error} tuple) on
    // failure, so simulate the DB error as a rejection - previously (before userDataApi was
    // explicitly mocked here) this test passed "by accident" because the unmocked module
    // made a real fetch() that rejected with ECONNREFUSED in the test sandbox; now that it's
    // mocked, the rejection needs to be explicit.
    vi.mocked(userDataApi.getCharacter).mockRejectedValue(new Error('Supabase error'));

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/characters'));
    // #2150: the real reason reaches the toast and the log, not a catch-all string.
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Failed to load character data',
        description: 'Error while fetching the character: Supabase error',
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Error fetching the character',
      expect.objectContaining({
        characterId: mockCharacterId,
        reason: 'Supabase error',
        error: expect.any(Error),
      }),
    );
  });

  it('names the stage when reading the payload throws (#2150)', async () => {
    // A payload whose field access throws partway through the transform.
    vi.mocked(userDataApi.getCharacter).mockResolvedValue(
      new Proxy(
        { id: mockCharacterId, name: 'Broken', race: 'Human', class: 'Fighter', level: 1 },
        {
          get: (target: Record<string, unknown>, prop: string) => {
            if (prop === 'cantrips') throw new TypeError('cantrips is unreadable');
            return target[prop];
          },
        },
      ),
    );

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Error while reading the character data: cantrips is unreadable',
        }),
      ),
    );
  });

  it('reports stored names the client tables do not know (#2150)', async () => {
    vi.mocked(userDataApi.getCharacter).mockResolvedValue({
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'The Reveler',
      race: 'Starborn Owlkin',
      class: 'Barbarian',
      level: 1,
      character_stats: [],
    });

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.race?.name).toBe('Starborn Owlkin');
    expect(result.current.unresolvedData).toEqual(['Unknown race: Starborn Owlkin']);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('loads the character without equipment when the equipment request fails (#2150)', async () => {
    vi.mocked(userDataApi.getCharacter).mockResolvedValue({
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'The Reveler',
      race: 'Human',
      class: 'Barbarian',
      level: 1,
      character_stats: [],
    });
    vi.mocked(issue1784Api.getCharacterEquipment).mockRejectedValue(
      new Error('Unparseable response body from /v1/characters/x/equipment'),
    );

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.name).toBe('The Reveler');
    expect(result.current.character?.equipment).toEqual([]);
    expect(result.current.equipmentUnavailable).toBe(true);
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('should handle character data as an array from Supabase', async () => {
    // Sometimes .select() can return an array even if we expect a single object if not careful
    const mockCharacterData = [
      {
        id: mockCharacterId,
        user_id: mockUserId,
        name: 'Array Hero',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        character_stats: [
          {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        ],
        character_equipment: [],
      },
    ];

    vi.mocked(userDataApi.getCharacter).mockResolvedValue(mockCharacterData);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.name).toBe('Array Hero');
  });

  it('should handle missing stats and equipment', async () => {
    const mockCharacterData = {
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'Minimal Hero',
      race: 'Human',
      class: 'Fighter',
      level: 1,
      character_stats: null,
      character_equipment: null,
    };

    vi.mocked(userDataApi.getCharacter).mockResolvedValue(mockCharacterData);
    vi.mocked(issue1784Api.getCharacterEquipment).mockResolvedValue([]);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.name).toBe('Minimal Hero');
    expect(result.current.character?.abilityScores!.strength.score).toBe(10);
    expect(result.current.character?.equipment).toEqual([]);
  });

  it('should parse spell lists stored as JSON arrays', async () => {
    const mockCharacterData = {
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'JSON Hero',
      race: 'Elf',
      class: 'Wizard',
      level: 3,
      cantrips: '["mage-hand", "light"]',
      known_spells: '["magic-missile", "shield"]',
      prepared_spells: '["shield"]',
      ritual_spells: '["detect-magic"]',
      character_stats: null,
      character_equipment: [],
    };

    vi.mocked(userDataApi.getCharacter).mockResolvedValue(mockCharacterData);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.cantrips).toEqual(['mage-hand', 'light']);
    expect(result.current.character?.knownSpells).toEqual(['magic-missile', 'shield']);
    expect(result.current.character?.preparedSpells).toEqual(['shield']);
    expect(result.current.character?.ritualSpells).toEqual(['detect-magic']);
  });

  it('should keep supporting legacy comma-separated spell lists without warning', async () => {
    const mockCharacterData = {
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'Legacy Hero',
      race: 'Human',
      class: 'Bard',
      level: 2,
      cantrips: 'mage-hand, light',
      known_spells: 'magic-missile, shield',
      prepared_spells: 'shield',
      ritual_spells: 'detect-magic',
      character_stats: null,
      character_equipment: [],
    };

    vi.mocked(userDataApi.getCharacter).mockResolvedValue(mockCharacterData);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.cantrips).toEqual(['mage-hand', 'light']);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Failed to parse character JSON field',
      expect.anything(),
    );
  });

  // #1679: a hurt hero in another open tab reaches this sheet on the engine's state event or on
  // window focus, so Heal self reflects the current HP without a reload.
  it('refetches the character when character-state-updated fires', async () => {
    vi.mocked(userDataApi.getCharacter).mockResolvedValue({
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'Test Hero',
      character_stats: {},
    } as any);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(userDataApi.getCharacter).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new CustomEvent('character-state-updated'));
    });

    await waitFor(() => expect(userDataApi.getCharacter).toHaveBeenCalledTimes(2));
  });

  it('refetches the character when the window regains focus', async () => {
    vi.mocked(userDataApi.getCharacter).mockResolvedValue({
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'Test Hero',
      character_stats: {},
    } as any);

    const { result } = renderHook(() => useCharacterData(mockCharacterId));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(userDataApi.getCharacter).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(userDataApi.getCharacter).toHaveBeenCalledTimes(2));
  });

  // #1679 / strategist FIX: the quiet refresh is debounced, drops stale responses, logs (no toast)
  // on failure, and waits while a text field is being edited.
  describe('quiet refresh guards (#1679)', () => {
    const sheetRow = (name: string): any => ({
      id: mockCharacterId,
      user_id: mockUserId,
      name,
      character_stats: {},
    });
    const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    const deferredValue = <T>(): { promise: Promise<T>; resolve: (value: T) => void } => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };

    it('a burst of state events is one refetch', async () => {
      vi.mocked(userDataApi.getCharacter).mockResolvedValue(sheetRow('Test Hero'));
      const { result } = renderHook(() => useCharacterData(mockCharacterId));
      await waitFor(() => expect(result.current.loading).toBe(false));

      act(() => {
        window.dispatchEvent(new CustomEvent('character-state-updated'));
        window.dispatchEvent(new CustomEvent('character-state-updated'));
        window.dispatchEvent(new CustomEvent('character-state-updated'));
      });
      await waitFor(() => expect(userDataApi.getCharacter).toHaveBeenCalledTimes(2));
      await act(async () => {
        await pause(350);
      });
      expect(userDataApi.getCharacter).toHaveBeenCalledTimes(2);
    });

    it('a response older than the newest refetch does not overwrite it', async () => {
      const older = deferredValue<any>();
      const newer = deferredValue<any>();
      vi.mocked(userDataApi.getCharacter)
        .mockResolvedValueOnce(sheetRow('Test Hero'))
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      const { result } = renderHook(() => useCharacterData(mockCharacterId));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        window.dispatchEvent(new CustomEvent('character-state-updated'));
        await pause(350);
      });
      await act(async () => {
        window.dispatchEvent(new CustomEvent('character-state-updated'));
        await pause(350);
      });
      expect(userDataApi.getCharacter).toHaveBeenCalledTimes(3);

      await act(async () => {
        newer.resolve(sheetRow('Newer Hero'));
      });
      await waitFor(() => expect(result.current.character?.name).toBe('Newer Hero'));
      await act(async () => {
        older.resolve(sheetRow('Older Hero'));
        await pause(10);
      });
      expect(result.current.character?.name).toBe('Newer Hero');
    });

    it('a failed quiet refresh logs and shows no toast, and keeps the sheet', async () => {
      vi.mocked(userDataApi.getCharacter)
        .mockResolvedValueOnce(sheetRow('Test Hero'))
        .mockRejectedValueOnce(new Error('network down'));
      const { result } = renderHook(() => useCharacterData(mockCharacterId));
      await waitFor(() => expect(result.current.loading).toBe(false));
      mockToast.mockClear();

      act(() => {
        window.dispatchEvent(new CustomEvent('character-state-updated'));
      });
      await waitFor(() => expect(userDataApi.getCharacter).toHaveBeenCalledTimes(2));
      await act(async () => {
        await pause(10);
      });
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Failed to load character data' }),
      );
      expect(result.current.character?.name).toBe('Test Hero');
    });

    it('a refresh waits while a text field is being edited, then runs when focus leaves it', async () => {
      vi.mocked(userDataApi.getCharacter).mockResolvedValue(sheetRow('Test Hero'));
      const field = document.createElement('input');
      const other = document.createElement('button');
      document.body.append(field, other);
      try {
        const { result } = renderHook(() => useCharacterData(mockCharacterId));
        await waitFor(() => expect(result.current.loading).toBe(false));

        act(() => {
          field.focus();
          window.dispatchEvent(new CustomEvent('character-state-updated'));
        });
        await act(async () => {
          await pause(350);
        });
        expect(userDataApi.getCharacter).toHaveBeenCalledTimes(1);

        act(() => {
          other.focus();
        });
        await waitFor(() => expect(userDataApi.getCharacter).toHaveBeenCalledTimes(2));
      } finally {
        field.remove();
        other.remove();
      }
    });
  });
});
