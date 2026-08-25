/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
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

vi.mock('../lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
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

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createCharacter: vi.fn(),
    updateCharacter: vi.fn(),
    updateCharacterStats: vi.fn(),
  },
}));

vi.mock('@/utils/spell-id-mapping', () => ({
  convertSpellIdsToDatabase: vi.fn(() => []),
}));

import { useCharacterSave } from '../use-character-save';

import type { AbilityScores, Character } from '@/types/character';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { characterBackgroundGenerator } from '@/services/character-background-generator';
import { characterSpellService } from '@/services/characterSpellApi';
import { userDataApi } from '@/services/user-data-api';
import { convertSpellIdsToDatabase } from '@/utils/spell-id-mapping';

const makeAbilityScores = (constitution: number, dexterity = 10): AbilityScores => ({
  strength: { score: 10, modifier: 0, savingThrow: false },
  dexterity: {
    score: dexterity,
    modifier: Math.floor((dexterity - 10) / 2),
    savingThrow: false,
  },
  constitution: {
    score: constitution,
    modifier: Math.floor((constitution - 10) / 2),
    savingThrow: false,
  },
  intelligence: { score: 10, modifier: 0, savingThrow: false },
  wisdom: { score: 10, modifier: 0, savingThrow: false },
  charisma: { score: 10, modifier: 0, savingThrow: false },
});

const makeCharacter = (overrides: Record<string, unknown> = {}): Character =>
  ({
    id: 'character-1',
    name: 'Sheet Hero',
    level: 1,
    class: { name: 'Wizard' },
    abilityScores: makeAbilityScores(10),
    ...overrides,
  }) as unknown as Character;

const expectedAbilityPayload = (
  constitution: number,
  hp?: { current: number; maximum: number },
): Record<string, number> => ({
  strength: 10,
  dexterity: 10,
  constitution,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
  armor_class: 10,
  ...(hp
    ? {
        current_hit_points: hp.current,
        max_hit_points: hp.maximum,
      }
    : {}),
});

describe('useCharacterSave', () => {
  let queryClient: QueryClient;
  const mockToast = vi.fn();
  const mockInvalidateQueries = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.invalidateQueries = mockInvalidateQueries;

    (useToast as any).mockReturnValue({ toast: mockToast });
    (useAuth as any).mockReturnValue({ user: { id: 'user-123' } });
    (useCampaign as any).mockReturnValue({ state: { campaign: { id: 'campaign-123' } } });
    (convertSpellIdsToDatabase as any).mockReturnValue([]);
    (userDataApi.createCharacter as any).mockResolvedValue({ id: 'new-character-id' });
    (userDataApi.updateCharacter as any).mockResolvedValue({});
    (userDataApi.updateCharacterStats as any).mockResolvedValue(undefined);
    (characterBackgroundGenerator.generateCharacterBackground as any).mockResolvedValue(
      'generated-url',
    );
    (supabase.from as any).mockImplementation(() => ({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockResolvedValue({ error: null }),
      upsert: vi.fn().mockResolvedValue({ error: null }),
      select: vi.fn().mockReturnThis(),
    }));
  });

  const wrapper = ({ children }: { children: React.ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  const save = async (character: Character): Promise<Character | null> => {
    const { result } = renderHook(() => useCharacterSave(), { wrapper });
    let savedCharacter: Character | null = null;
    await act(async () => {
      savedCharacter = await result.current.saveCharacter(character);
    });
    return savedCharacter;
  };

  // Restored pre-existing create/update coverage.
  it('should save a new character through the authenticated API', async () => {
    const character = makeCharacter({
      id: undefined,
      name: 'New Hero',
      inventory: [{ itemId: 'item-1' }],
      cantrips: ['mage-hand'],
    });

    (convertSpellIdsToDatabase as any).mockReturnValue(['spell-uuid']);
    (characterSpellService.saveCharacterSpells as any).mockResolvedValue({});
    (characterBackgroundGenerator.generateCharacterBackground as any).mockResolvedValue(
      'image-url',
    );

    const savedCharacter = await save(character);

    expect(userDataApi.createCharacter).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New Hero', stats: expect.any(Object) }),
    );
    expect(savedCharacter?.id).toBe('new-character-id');
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(characterSpellService.saveCharacterSpells).toHaveBeenCalled();

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
    const savedCharacter = await save(
      makeCharacter({
        id: 'existing-id',
        name: 'Updated Hero',
        abilityScores: makeAbilityScores(12),
      }),
    );

    expect(userDataApi.updateCharacter).toHaveBeenCalledWith(
      'existing-id',
      expect.objectContaining({ name: 'Updated Hero' }),
    );
    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'existing-id',
      expect.any(Object),
    );
    expect(savedCharacter?.name).toBe('Updated Hero');
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });

  it('preserves stored HP when a level-2 character saves a sheet edit', async () => {
    const character = makeCharacter({
      id: 'existing-id',
      name: 'Renamed Veteran',
      level: 2,
      abilityScores: makeAbilityScores(12),
      character_stats: { max_hit_points: 30, current_hit_points: 17 },
    });

    await save(character);

    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'existing-id',
      expectedAbilityPayload(12),
    );
  });

  it('should handle API error when saving new character', async () => {
    (userDataApi.createCharacter as any).mockRejectedValue(new Error('API Failed'));

    const savedCharacter = await save(makeCharacter({ id: undefined, name: 'New Hero' }));

    expect(savedCharacter).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Error',
        description: expect.stringContaining('API Failed'),
      }),
    );
  });

  it('should handle update error for existing character', async () => {
    (userDataApi.updateCharacter as any).mockRejectedValue(new Error('Update Failed'));

    const savedCharacter = await save(makeCharacter({ id: 'existing-id', name: 'Updated Hero' }));

    expect(savedCharacter).toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Error',
        description: expect.stringContaining('Update Failed'),
      }),
    );
  });

  it('should continue if stats or equipment save fails during update', async () => {
    const character = makeCharacter({
      id: 'existing-id',
      name: 'Updated Hero',
      inventory: [{ itemId: 'item-1' }],
    });

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockResolvedValue({ error: null }),
        };
      }
      return { upsert: vi.fn().mockResolvedValue({ error: { message: 'Stats failed' } }) };
    });

    const savedCharacter = await save(character);

    expect(savedCharacter).not.toBeNull();
    expect(savedCharacter?.name).toBe('Updated Hero');
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Error',
      }),
    );
  });

  it('should handle spell save failure gracefully for existing character', async () => {
    const character = makeCharacter({
      id: 'existing-id',
      name: 'Hero',
      knownSpells: ['magic-missile'],
    });

    (convertSpellIdsToDatabase as any).mockReturnValue(['spell-uuid']);
    (characterSpellService.saveCharacterSpells as any).mockRejectedValue(
      new Error('Spell save failed'),
    );

    const savedCharacter = await save(character);

    expect(savedCharacter).not.toBeNull();
  });

  it('should skip spell save if no valid spell mappings found', async () => {
    const character = makeCharacter({
      id: 'existing-id',
      name: 'Hero',
      knownSpells: ['magic-missile'],
    });

    (convertSpellIdsToDatabase as any).mockReturnValue([]);

    const savedCharacter = await save(character);

    expect(savedCharacter).not.toBeNull();
    expect(characterSpellService.saveCharacterSpells).not.toHaveBeenCalled();
  });

  it('should handle spell save failure with toast for new character', async () => {
    const character = makeCharacter({
      id: undefined,
      name: 'New Hero',
      knownSpells: ['magic-missile'],
    });

    (userDataApi.createCharacter as any).mockResolvedValue({ id: 'new-id' });
    (convertSpellIdsToDatabase as any).mockReturnValue(['spell-uuid']);
    (characterSpellService.saveCharacterSpells as any).mockRejectedValue(
      new Error('Spell save failed'),
    );

    const savedCharacter = await save(character);

    expect(savedCharacter).not.toBeNull();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Partial Save Success',
        variant: 'destructive',
      }),
    );
  });

  it('should handle background image generation failure', async () => {
    const character = makeCharacter({ id: undefined, name: 'New Hero' });
    (characterBackgroundGenerator.generateCharacterBackground as any).mockRejectedValue(
      new Error('Generation failed'),
    );

    await save(character);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Background Image Generation Failed',
        }),
      );
    });
  });

  it('should use existing image as reference for background generation', async () => {
    const character = makeCharacter({
      id: undefined,
      name: 'New Hero',
      image_url: 'ref-url',
    });

    await save(character);

    await waitFor(() => {
      expect(characterBackgroundGenerator.generateCharacterBackground).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ referenceImageUrl: 'ref-url' }),
      );
    });
  });

  it('should handle background image database update failure', async () => {
    const character = makeCharacter({ id: undefined, name: 'New Hero' });
    (characterBackgroundGenerator.generateCharacterBackground as any).mockResolvedValue(
      'image-url',
    );
    (userDataApi.updateCharacter as any).mockRejectedValue(new Error('DB Update Failed'));

    await save(character);

    await waitFor(() => {
      expect(characterBackgroundGenerator.generateCharacterBackground).toHaveBeenCalled();
      expect(mockToast).not.toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Character Background Generated',
        }),
      );
    });
  });

  // HP payload-shape coverage uses the production transformer and real class formula.
  it('recomputes level-1 HP and fully heals when the stored row was full', async () => {
    await save(
      makeCharacter({
        id: 'level-one-full',
        abilityScores: makeAbilityScores(14),
        character_stats: { max_hit_points: 6, current_hit_points: 6 },
      }),
    );

    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'level-one-full',
      expectedAbilityPayload(14, { current: 8, maximum: 8 }),
    );
  });

  it('preserves a wounded level-1 current value while capping it at a reduced maximum', async () => {
    await save(
      makeCharacter({
        id: 'level-one-wounded',
        abilityScores: makeAbilityScores(8),
        character_stats: { max_hit_points: 8, current_hit_points: 7 },
      }),
    );

    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'level-one-wounded',
      expectedAbilityPayload(8, { current: 5, maximum: 5 }),
    );
  });

  it('fully heals a level-1 character when a full stored row gets a lower maximum', async () => {
    await save(
      makeCharacter({
        id: 'level-one-full-decrease',
        abilityScores: makeAbilityScores(8),
        character_stats: { max_hit_points: 8, current_hit_points: 8 },
      }),
    );

    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'level-one-full-decrease',
      expectedAbilityPayload(8, { current: 5, maximum: 5 }),
    );
  });

  it('omits HP keys from a level-2 sheet update', async () => {
    await save(
      makeCharacter({
        id: 'level-two',
        level: 2,
        abilityScores: makeAbilityScores(14),
        character_stats: { max_hit_points: 30, current_hit_points: 17 },
      }),
    );

    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'level-two',
      expectedAbilityPayload(14),
    );
  });

  it('sends full computed HP when a level-1 character has no stats row', async () => {
    await save(
      makeCharacter({
        id: 'level-one-no-stats',
        abilityScores: makeAbilityScores(14),
        character_stats: [],
      }),
    );

    expect(userDataApi.updateCharacterStats).toHaveBeenCalledWith(
      'level-one-no-stats',
      expectedAbilityPayload(14, { current: 8, maximum: 8 }),
    );
  });

  it('sends exact class-based HP values when creating a character', async () => {
    await save(
      makeCharacter({
        id: undefined,
        name: 'New Wizard',
        abilityScores: makeAbilityScores(14),
      }),
    );

    expect(userDataApi.createCharacter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New Wizard',
        stats: {
          strength: 10,
          dexterity: 10,
          constitution: 14,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
          armor_class: 10,
          current_hit_points: 8,
          max_hit_points: 8,
        },
      }),
    );
  });
});
