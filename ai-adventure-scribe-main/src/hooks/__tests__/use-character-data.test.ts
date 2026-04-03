/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(),
    })),
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

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '@/lib/logger';
import { isValidUUID } from '@/utils/validation';

import { useCharacterData } from '../use-character-data';

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
      character_equipment: [
        { item_name: 'Longsword', id: 'item-1', quantity: 1, equipped: true },
      ],
    };

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
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

    expect(supabase.from).toHaveBeenCalledWith('characters');
  });

  it('should handle invalid character ID UUID', async () => {
    (isValidUUID as any).mockReturnValue(false);

    renderHook(() => useCharacterData('invalid-uuid'));

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Invalid Character',
      variant: 'destructive',
    }));
    expect(mockNavigate).toHaveBeenCalledWith('/app/characters');
  });

  it('should handle unauthenticated user', async () => {
    (useAuth as any).mockReturnValue({ user: null });

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login'));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Not Authenticated',
    }));
  });

  it('should handle character not found or unauthorized', async () => {
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    });

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/app/characters'));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Character Not Found',
    }));
  });

  it('should handle database errors', async () => {
    const mockError = { message: 'Supabase error' };
    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    });

    renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/characters'));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Error',
    }));
  });

  it('should handle character data as an array from Supabase', async () => {
    // Sometimes .select() can return an array even if we expect a single object if not careful
    const mockCharacterData = [{
      id: mockCharacterId,
      user_id: mockUserId,
      name: 'Array Hero',
      race: 'Human',
      class: 'Fighter',
      level: 1,
      character_stats: [{ strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }],
      character_equipment: [],
    }];

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    });

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

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
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

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    });

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

    const mockMaybeSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
    (supabase.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    });

    const { result } = renderHook(() => useCharacterData(mockCharacterId));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.character?.cantrips).toEqual(['mage-hand', 'light']);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'Failed to parse character JSON field',
      expect.anything(),
    );
  });
});
