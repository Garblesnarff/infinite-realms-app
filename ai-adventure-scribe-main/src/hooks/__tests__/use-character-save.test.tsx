/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

// Mock the same logger path as imported in the hook
vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: vi.fn(),
}));

vi.mock('@/services/character-background-generator', () => ({
  characterBackgroundGenerator: {
    generateCharacterBackground: vi.fn(),
  },
}));

vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    saveCharacterSpells: vi.fn(),
  },
}));

vi.mock('@/utils/spell-id-mapping', () => ({
  convertSpellIdsToDatabase: vi.fn(() => []),
}));

vi.mock('@/types/character', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    transformCharacterForStorage: vi.fn((c) => ({ ...c, transformed: true })),
  };
});

vi.mock('@/utils/characterTransformations', () => ({
  transformAbilityScoresForStorage: vi.fn(() => ({ strength: 10 })),
  transformEquipmentForStorage: vi.fn(() => [{ item_name: 'Sword' }]),
  transformMulticlassingForStorage: vi.fn(() => ({})),
}));

import { useCharacterSave } from '../use-character-save';

import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { supabase } from '@/integrations/supabase/client';
import { characterBackgroundGenerator } from '@/services/character-background-generator';
import { characterSpellService } from '@/services/characterSpellApi';
import { convertSpellIdsToDatabase } from '@/utils/spell-id-mapping';

const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

describe('useCharacterSave', () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockInvalidateQueries = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = createQueryClient();
    queryClient.invalidateQueries = mockInvalidateQueries;

    (useToast as any).mockReturnValue({ toast: mockToast });
    (useAuth as any).mockReturnValue({ user: { id: 'user-123' } });
    (useCampaign as any).mockReturnValue({ state: { campaign: { id: 'campaign-123' } } });
    (convertSpellIdsToDatabase as any).mockReturnValue([]);
  });

  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it('should save a new character successfully using RPC', async () => {
    const character: any = {
      name: 'New Hero',
      abilityScores: { strength: { score: 10 } },
      inventory: [{ itemId: 'item-1' }],
      cantrips: ['mage-hand'],
    };

    (supabase.rpc as any).mockResolvedValue({ data: 'new-char-id', error: null });
    (convertSpellIdsToDatabase as any).mockReturnValue(['spell-uuid']);
    (characterSpellService.saveCharacterSpells as any).mockResolvedValue({});
    (characterBackgroundGenerator.generateCharacterBackground as any).mockResolvedValue(
      'image-url',
    );

    // For background image update
    (supabase.from as any).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: null }),
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      'create_character_atomic',
      expect.objectContaining({
        character_data: expect.objectContaining({ name: 'New Hero' }),
      }),
    );
    expect(savedCharacter.id).toBe('new-char-id');
    expect(mockInvalidateQueries).toHaveBeenCalled();
    // Spell save check
    expect(characterSpellService.saveCharacterSpells).toHaveBeenCalled();

    // Verify background image generation was triggered
    await waitFor(() => {
      expect(characterBackgroundGenerator.generateCharacterBackground).toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Character Background Generated',
        }),
      );
    });
  });

  it('should update an existing character successfully', async () => {
    const character: any = {
      id: 'existing-id',
      name: 'Updated Hero',
      abilityScores: { strength: { score: 12 } },
    };

    const mockUpdate = vi.fn().mockReturnThis();
    const mockEq = vi.fn().mockReturnThis();
    const mockOr = vi.fn().mockResolvedValue({ error: null });
    const mockUpsert = vi.fn().mockResolvedValue({ error: null });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return { update: mockUpdate, eq: mockEq, or: mockOr };
      }
      if (table === 'character_stats' || table === 'character_equipment') {
        return { upsert: mockUpsert };
      }
      return {};
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(mockUpdate).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith('id', 'existing-id');
    expect(mockUpsert).toHaveBeenCalled(); // For stats
    expect(savedCharacter.name).toBe('Updated Hero');
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it('should handle RPC error when saving new character', async () => {
    const character: any = { name: 'New Hero', abilityScores: {} };
    (supabase.rpc as any).mockResolvedValue({ data: null, error: { message: 'RPC Failed' } });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(savedCharacter).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Error',
        description: expect.stringContaining('RPC Failed'),
      }),
    );
  });

  it('should handle update error for existing character', async () => {
    const character: any = { id: 'existing-id', name: 'Updated Hero', abilityScores: {} };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockResolvedValue({ error: { message: 'Update Failed' } }),
        };
      }
      return {
        upsert: vi.fn().mockResolvedValue({ error: null }),
      };
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(savedCharacter).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Error',
        description: expect.stringContaining('Update Failed'),
      }),
    );
  });

  it('should continue if stats or equipment save fails during update', async () => {
    const character: any = {
      id: 'existing-id',
      name: 'Updated Hero',
      abilityScores: { strength: { score: 12 } },
      inventory: [{ itemId: 'item-1' }],
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      // Fail stats save but succeed core character save
      return { upsert: vi.fn().mockResolvedValue({ error: { message: 'Stats failed' } }) };
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(savedCharacter).not.toBeNull();
    expect(savedCharacter.name).toBe('Updated Hero');
    // Should NOT show a "Save Error" toast for non-blocking failures
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Error',
      }),
    );
  });

  it('should handle spell save failure gracefully for existing character', async () => {
    const character: any = {
      id: 'existing-id',
      name: 'Hero',
      abilityScores: {},
      knownSpells: ['magic-missile'],
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return { upsert: vi.fn().mockResolvedValue({ error: null }) };
    });

    (convertSpellIdsToDatabase as any).mockReturnValue(['spell-uuid']);
    (characterSpellService.saveCharacterSpells as any).mockRejectedValue(
      new Error('Spell save failed'),
    );

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(savedCharacter).not.toBeNull();
    // Should still return character even if spells fail
  });

  it('should skip spell save if no valid spell mappings found', async () => {
    const character: any = {
      id: 'existing-id',
      name: 'Hero',
      abilityScores: {},
      knownSpells: ['magic-missile'],
    };

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return { upsert: vi.fn().mockResolvedValue({ error: null }) };
    });

    (convertSpellIdsToDatabase as any).mockReturnValue([]); // No valid mappings

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(savedCharacter).not.toBeNull();
    expect(characterSpellService.saveCharacterSpells).not.toHaveBeenCalled();
  });

  it('should handle spell save failure with toast for new character', async () => {
    const character: any = {
      name: 'New Hero',
      abilityScores: {},
      knownSpells: ['magic-missile'],
    };

    (supabase.rpc as any).mockResolvedValue({ data: 'new-id', error: null });
    (convertSpellIdsToDatabase as any).mockReturnValue(['spell-uuid']);
    (characterSpellService.saveCharacterSpells as any).mockRejectedValue(
      new Error('Spell save failed'),
    );

    (supabase.from as any).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: null }),
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    let savedCharacter;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });

    expect(savedCharacter).not.toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Partial Save Success',
        variant: 'destructive',
      }),
    );
  });

  it('should handle background image generation failure', async () => {
    const character: any = { name: 'New Hero', abilityScores: {} };
    (supabase.rpc as any).mockResolvedValue({ data: 'new-char-id', error: null });
    (characterBackgroundGenerator.generateCharacterBackground as any).mockRejectedValue(
      new Error('Generation failed'),
    );

    (supabase.from as any).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: null }),
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    await act(async () => {
      await result.current.saveCharacter(character);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Background Image Generation Failed',
        }),
      );
    });
  });

  it('should use existing image as reference for background generation', async () => {
    const character: any = { name: 'New Hero', abilityScores: {}, image_url: 'ref-url' };
    (supabase.rpc as any).mockResolvedValue({ data: 'new-char-id', error: null });
    (characterBackgroundGenerator.generateCharacterBackground as any).mockResolvedValue(
      'image-url',
    );

    (supabase.from as any).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: null }),
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    await act(async () => {
      await result.current.saveCharacter(character);
    });

    await waitFor(() => {
      expect(characterBackgroundGenerator.generateCharacterBackground).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ referenceImageUrl: 'ref-url' }),
      );
    });
  });

  it('should handle background image database update failure', async () => {
    const character: any = { name: 'New Hero', abilityScores: {} };
    (supabase.rpc as any).mockResolvedValue({ data: 'new-char-id', error: null });
    (characterBackgroundGenerator.generateCharacterBackground as any).mockResolvedValue(
      'image-url',
    );

    (supabase.from as any).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: { message: 'DB Update Failed' } }),
    });

    const { result } = renderHook(() => useCharacterSave(), { wrapper });

    await act(async () => {
      await result.current.saveCharacter(character);
    });

    await waitFor(() => {
      expect(characterBackgroundGenerator.generateCharacterBackground).toHaveBeenCalled();
      // Should log error but not toast success if DB update fails
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Character Background Generated',
        }),
      );
    });
  });
});
