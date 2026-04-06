/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies BEFORE importing module under test
vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { characterSpellService } from '../characterSpellApi';

import { waitForAuth } from '@/lib/auth-gate';
import logger from '@/lib/logger';

describe('CharacterSpellService', () => {
  const mockFetch = vi.fn();
  const mockCharacterId = 'char-123';
  const mockToken = 'mock-token';

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch as any;

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue(mockToken),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn(),
      length: 0,
      key: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);
    vi.stubGlobal('window', {
      localStorage: localStorageMock,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getCharacterSpells', () => {
    it('should fetch character spells successfully', async () => {
      // Arrange
      const mockSpellsData = {
        character: { id: mockCharacterId, class: 'Wizard', level: 5 },
        cantrips: [{ id: 'c1', name: 'Mage Hand', is_prepared: true, source_feature: 'class' }],
        spells: [{ id: 's1', name: 'Magic Missile', is_prepared: true, source_feature: 'class' }],
        total_spells: 2,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSpellsData,
      });

      // Act
      const result = await characterSpellService.getCharacterSpells(mockCharacterId);

      // Assert
      expect(waitForAuth).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/characters/${mockCharacterId}/spells`),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
          }),
        }),
      );
      expect(result).toEqual(mockSpellsData);
    });

    it('should return empty spells if character is not found', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Character not found' }),
      });

      // Act
      const result = await characterSpellService.getCharacterSpells(mockCharacterId);

      // Assert
      expect(result.character.id).toBe(mockCharacterId);
      expect(result.cantrips).toEqual([]);
      expect(result.spells).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('should throw error for other API failures', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal Server Error' }),
      });

      // Act & Assert
      await expect(characterSpellService.getCharacterSpells(mockCharacterId)).rejects.toThrow(
        'Internal Server Error',
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('saveCharacterSpells', () => {
    it('should save character spells successfully', async () => {
      // Arrange
      const mockRequest = { spells: ['s1', 's2'], className: 'Wizard' };
      const mockResponse = { success: true, message: 'Spells saved' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      // Act
      const result = await characterSpellService.saveCharacterSpells(mockCharacterId, mockRequest);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/characters/${mockCharacterId}/spells`),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(mockRequest),
        }),
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteCharacterSpell', () => {
    it('should delete a character spell successfully', async () => {
      // Arrange
      const mockSpellId = 'spell-456';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      // Act
      await characterSpellService.deleteCharacterSpell(mockCharacterId, mockSpellId);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/characters/${mockCharacterId}/spells/${mockSpellId}`),
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('updateSpellPreparation', () => {
    it('should update spell preparation successfully', async () => {
      // Arrange
      const mockSpellId = 'spell-789';
      const isPrepared = true;
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      // Act
      await characterSpellService.updateSpellPreparation(mockCharacterId, mockSpellId, isPrepared);

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/v1/characters/${mockCharacterId}/spells/${mockSpellId}/preparation`),
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ is_prepared: isPrepared }),
        }),
      );
    });
  });

  describe('Authentication and Token Handling', () => {
    it('should throw error if no token is found', async () => {
      // Arrange
      (window.localStorage.getItem as any).mockReturnValue(null);

      // Act & Assert
      await expect(characterSpellService.getCharacterSpells(mockCharacterId)).rejects.toThrow(
        'No authentication token found. Please log in.',
      );
    });

    it('should handle 401 unauthorized from API', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: vi.fn().mockRejectedValue(new Error('no body')),
      });

      // Act & Assert
      await expect(characterSpellService.getCharacterSpells(mockCharacterId)).rejects.toThrow(
        'Your session has expired. Please sign in again.',
      );
    });

    it('should handle specialized 401 "invalid token" message', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'invalid token' }),
      });

      // Act & Assert
      await expect(characterSpellService.getCharacterSpells(mockCharacterId)).rejects.toThrow(
        'Authentication expired. Please sign in again.',
      );
    });

    it('should parse specialized error messages from response', async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ message: 'Invalid spells selected' }),
      });

      // Act & Assert
      await expect(characterSpellService.getCharacterSpells(mockCharacterId)).rejects.toThrow(
        'Invalid spells selected',
      );
    });
  });
});
