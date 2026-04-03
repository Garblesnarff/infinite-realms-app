/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { PersonalityService } from '../personalityService';

describe('PersonalityService', () => {
  let service: PersonalityService;
  const mockFetch = vi.fn();

  beforeEach(() => {
    service = new PersonalityService();
    // Reset global fetch mock
    mockFetch.mockReset();
    global.fetch = mockFetch as any;

    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn().mockReturnValue('mock-token'),
      setItem: vi.fn(),
      clear: vi.fn(),
      removeItem: vi.fn(),
      length: 0,
      key: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageMock);

    // Some code uses window.localStorage explicitly
    vi.stubGlobal('window', {
      localStorage: localStorageMock,
    });

    // Mock Math.random for deterministic fallback tests
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('getRandomPersonalityElement', () => {
    it('should fetch a random personality element with correct URL and headers', async () => {
      const mockData = { id: '1', text: 'I am very brave.' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockData }),
      });

      const result = await service.getRandomPersonalityElement('traits', {
        background: 'Soldier',
        alignment: 'Lawful Good',
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/personality/random/traits?background=Soldier&alignment=Lawful+Good'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(result).toEqual(mockData);
    });

    it('should handle API errors by throwing', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(service.getRandomPersonalityElement('traits')).rejects.toThrow(
        'API request failed: 500 Internal Server Error'
      );
    });

    it('should switch to local fallback on connection error', async () => {
      // Simulate connection error
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      const result = await service.getRandomPersonalityElement('traits');

      // Should return first item from fallbackData.traits due to Math.random() = 0
      expect(result.text).toBe("I idolize a particular hero of my faith, and constantly refer to that person's deeds and example.");
      expect(result.id).toContain('fallback-');

      // Subsequent calls should use fallback immediately without calling fetch
      mockFetch.mockClear();
      const secondResult = await service.getRandomPersonalityElement('ideals');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(secondResult.ideal).toBe('Tradition. The ancient traditions of worship and sacrifice must be preserved and upheld.');
    });
  });

  describe('getBatchRandomPersonality', () => {
    it('should fetch batch personality elements', async () => {
      const mockBatchData = {
        traits: { id: 't1', text: 'Trait 1' },
        ideals: { id: 'i1', ideal: 'Ideal 1' },
        bonds: { id: 'b1', bond: 'Bond 1' },
        flaws: { id: 'f1', flaw: 'Flaw 1' },
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockBatchData }),
      });

      const result = await service.getBatchRandomPersonality({ background: 'Acolyte' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/personality/batch/random?background=Acolyte'),
        expect.any(Object)
      );
      expect(result).toEqual(mockBatchData);
    });

    it('should return batch local fallback data when API is unavailable', async () => {
      service['useLocalFallback'] = true; // Manually trigger fallback for this test

      const result = await service.getBatchRandomPersonality();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result.traits.text).toBeDefined();
      expect(result.ideals.ideal).toBeDefined();
      expect(result.bonds.bond).toBeDefined();
      expect(result.flaws.flaw).toBeDefined();
    });
  });

  describe('getPersonalityElements', () => {
    it('should fetch a list of personality elements', async () => {
      const mockElements = [{ id: '1', text: 'Element 1' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: mockElements }),
      });

      const result = await service.getPersonalityElements('traits', { limit: 5, background: 'Sage' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/personality/traits?background=Sage&limit=5'),
        expect.any(Object)
      );
      expect(result).toEqual(mockElements);
    });

    it('should return local fallback data array when API is unavailable', async () => {
      service['useLocalFallback'] = true;

      const result = await service.getPersonalityElements('flaws');

      expect(result).toBeInstanceOf(Array);
      expect(result).toHaveLength(1);
      expect(result[0].flaw).toBeDefined();
    });
  });

  describe('Local Fallback Mappings', () => {
    beforeEach(() => {
      service['useLocalFallback'] = true;
    });

    it('should map traits to "text" field', async () => {
      const result = await service.getRandomPersonalityElement('traits');
      expect(result.text).toBeDefined();
      expect(result.ideal).toBeUndefined();
    });

    it('should map ideals to "ideal" field', async () => {
      const result = await service.getRandomPersonalityElement('ideals');
      expect(result.ideal).toBeDefined();
      expect(result.text).toBeUndefined();
    });

    it('should map bonds to "bond" field', async () => {
      const result = await service.getRandomPersonalityElement('bonds');
      expect(result.bond).toBeDefined();
    });

    it('should map flaws to "flaw" field', async () => {
      const result = await service.getRandomPersonalityElement('flaws');
      expect(result.flaw).toBeDefined();
    });

    it('should handle default case in fallback mapping', async () => {
      const result = await service['getLocalFallbackData']('invalid' as any);
      expect(result.text).toBeDefined();
    });
  });

  describe('fetchWithAuth Edge Cases', () => {
    it('should not include Authorization header if token is missing', async () => {
      vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null) });
      vi.stubGlobal('window', { localStorage: { getItem: vi.fn().mockReturnValue(null) } });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: {} }),
      });

      await service.getRandomPersonalityElement('traits');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
          },
        })
      );
    });

    it('should handle non-TypeError fetch rejections', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Normal Error'));

      await expect(service.getRandomPersonalityElement('traits')).rejects.toThrow('Normal Error');
      expect(service['useLocalFallback']).toBe(false);
    });
  });
});
