/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// useCharacterData is a hybrid: character fetching moved from supabase.from('characters') to
// userDataApi.getCharacter() (the Bun server's REST API client), while character_equipment is
// still queried directly via supabase.from('character_equipment') - see
// src/hooks/use-character-data.ts. Both need to be mocked. eq() resolves directly (no
// .maybeSingle()) since the equipment query is awaited as part of Promise.all without a
// terminal single-row call.
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    })),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacter: vi.fn(),
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

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

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
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
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
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({
        data: [{ item_name: 'Longsword', id: 'item-1', quantity: 1, equipped: true }],
        error: null,
      }),
    });

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.character).not.toBeNull();
    expect(result.current.character?.name).toBe('Test Hero');
    expect(result.current.character?.abilityScores.strength.score).toBe(15);
    expect(result.current.character?.abilityScores.strength.modifier).toBe(2);
    expect(result.current.character?.cantrips).toEqual(['mage-hand', 'light']);
    expect(result.current.character?.knownSpells).toEqual(['magic-missile', 'shield']);
    expect(result.current.character?.equipment).toContain('Longsword');
    expect(result.current.character?.inventory[0].itemId).toBe('item-1');
    expect(result.current.character?.inventory[0].equipped).toBe(true);

    expect(userDataApi.getCharacter).toHaveBeenCalledWith(mockCharacterId);
    expect(supabase.from).toHaveBeenCalledWith('character_equipment');
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
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
      }),
    );
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
    // Explicitly reset the equipment query mock - vi.clearAllMocks() in beforeEach clears
    // call history but not a prior test's supabase.from().mockReturnValue() implementation,
    // so without this the "fetch and transform" test's Longsword equipment mock would leak in.
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: [], error: null }),
    });

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.name).toBe('Minimal Hero');
    expect(result.current.character?.abilityScores.strength.score).toBe(10);
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
});
