/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { characterLoaderService } from '../character-loader';
import { characterSpellService } from '../characterSpellApi';

import { supabase } from '@/integrations/supabase/client';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    })),
  },
}));

vi.mock('../characterSpellApi', () => ({
  characterSpellService: {
    getCharacterSpells: vi.fn(),
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

vi.mock('@/utils/spell-id-mapping', () => ({
  convertSpellIdsToFrontend: vi.fn((ids) => ids.map((id: string) => `kebab-${id}`)),
}));

describe('CharacterLoaderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadCharacterWithSpells', () => {
    const mockCharacterData = {
      id: 'char-123',
      user_id: 'user-456',
      name: 'Test Character',
      race: 'Elf',
      class: 'Wizard',
      level: 5,
      experience_points: 6500,
      alignment: 'Neutral Good',
      description: 'A test character',
      cantrips: 'fire-bolt, mage-hand',
      known_spells: 'magic-missile, shield',
      prepared_spells: 'magic-missile',
      ritual_spells: 'identify',
      character_stats: [
        {
          strength: 10,
          dexterity: 14,
          constitution: 12,
          intelligence: 18,
          wisdom: 13,
          charisma: 11,
        },
      ],
    };

    it('should load a character successfully with all spells from database', async () => {
      // Arrange
      const mockSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      (characterSpellService.getCharacterSpells as any).mockResolvedValue({
        cantrips: [],
        spells: [],
      });

      // Act
      const result = await characterLoaderService.loadCharacterWithSpells('char-123', 'user-456');

      // Assert
      expect(result).not.toBeNull();
      expect(result?.name).toBe('Test Character');
      expect(result?.cantrips).toEqual(['fire-bolt', 'mage-hand']);
      expect(result?.knownSpells).toEqual(['magic-missile', 'shield']);
      expect(result?.preparedSpells).toEqual(['magic-missile']);
      expect(result?.ritualSpells).toEqual(['identify']);
      expect(result?.abilityScores.intelligence.score).toBe(18);
      expect(result?.abilityScores.intelligence.modifier).toBe(4);
    });

    it('should enhance database spells with API spell data', async () => {
      // Arrange
      const mockSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      (characterSpellService.getCharacterSpells as any).mockResolvedValue({
        cantrips: [{ spell_id: 'uuid-firebolt' }],
        spells: [{ spell_id: 'uuid-fireball' }],
      });

      // Act
      const result = await characterLoaderService.loadCharacterWithSpells('char-123');

      // Assert
      expect(result?.cantrips).toEqual(['kebab-uuid-firebolt']);
      expect(result?.knownSpells).toEqual(['kebab-uuid-fireball']);
    });

    it('should return null when character is not found', async () => {
      // Arrange
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      // Act
      const result = await characterLoaderService.loadCharacterWithSpells('non-existent');

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when database query fails', async () => {
      // Arrange
      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      // Act
      const result = await characterLoaderService.loadCharacterWithSpells('char-123');

      // Assert
      expect(result).toBeNull();
    });

    it('should handle missing character stats by using defaults', async () => {
      // Arrange
      const dataNoStats = { ...mockCharacterData, character_stats: null };
      const mockSingle = vi.fn().mockResolvedValue({ data: dataNoStats, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      // Act
      const result = await characterLoaderService.loadCharacterWithSpells('char-123');

      // Assert
      expect(result?.abilityScores.strength.score).toBe(10);
      expect(result?.abilityScores.strength.modifier).toBe(0);
    });

    it('should handle API enhancement failure gracefully', async () => {
      // Arrange
      const mockSingle = vi.fn().mockResolvedValue({ data: mockCharacterData, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      (characterSpellService.getCharacterSpells as any).mockRejectedValue(new Error('API Error'));

      // Act
      const result = await characterLoaderService.loadCharacterWithSpells('char-123');

      // Assert
      expect(result).not.toBeNull();
      expect(result?.cantrips).toEqual(['fire-bolt', 'mage-hand']); // Falls back to DB
    });
  });

  describe('loadCharacterBySession', () => {
    it('should load character details by game session ID', async () => {
      // Arrange
      const mockSession = { character_id: 'char-123', user_id: 'user-456' };
      const mockCharacter = {
        id: 'char-123',
        user_id: 'user-456',
        name: 'Session Hero',
        race: 'Dwarf',
        class: 'Fighter',
        level: 3,
        character_stats: [{ strength: 16 }],
        character_equipment: [{ item_name: 'Battleaxe' }],
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCharacter, error: null }),
      });

      // Act
      const result = await characterLoaderService.loadCharacterBySession('session-789', 'user-456');

      // Assert
      expect(result).toBeDefined();
      expect(result?.name).toBe('Session Hero');
      expect(result?.equipment).toEqual(['Battleaxe']);
      expect(result?.abilityScores?.strength.score).toBe(16);
    });

    it('should return undefined when session is not found', async () => {
      // Arrange
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Act
      const result = await characterLoaderService.loadCharacterBySession('bad-session');

      // Assert
      expect(result).toBeUndefined();
    });

    it('should return undefined when character associated with session is not found', async () => {
      // Arrange
      const mockSession = { character_id: 'char-123', user_id: 'user-456' };
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      // Act
      const result = await characterLoaderService.loadCharacterBySession('session-789');

      // Assert
      expect(result).toBeUndefined();
    });

    it('should handle character with no stats or equipment in loadCharacterBySession', async () => {
      // Arrange
      const mockSession = { character_id: 'char-123', user_id: 'user-456' };
      const mockCharacter = {
        id: 'char-123',
        user_id: 'user-456',
        name: 'Simple Hero',
        character_stats: null,
        character_equipment: null,
      };

      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null }),
      });
      (fromSpy as any).mockReturnValueOnce({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockCharacter, error: null }),
      });

      // Act
      const result = await characterLoaderService.loadCharacterBySession('session-789');

      // Assert
      expect(result).toBeDefined();
      expect(result?.abilityScores).toBeUndefined();
      expect(result?.equipment).toEqual([]);
    });

    it('should return undefined when loadCharacterBySession throws an error', async () => {
      // Arrange
      const fromSpy = vi.spyOn(supabase, 'from');
      (fromSpy as any).mockImplementation(() => {
        throw new Error('Unexpected Error');
      });

      // Act
      const result = await characterLoaderService.loadCharacterBySession('any-session');

      // Assert
      expect(result).toBeUndefined();
    });
  });
});
