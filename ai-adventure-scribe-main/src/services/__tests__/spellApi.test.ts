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

vi.mock('../localSpellService', () => ({
  localSpellService: {
    getAllSpells: vi.fn(),
    getClassSpells: vi.fn(),
    getSpellProgression: vi.fn(),
    getMulticlassSpellSlots: vi.fn(),
    getSpellcastingClasses: vi.fn(),
    calculateMulticlassCasterLevel: vi.fn(),
    getSpellById: vi.fn(),
  },
}));

import { localSpellService } from '../localSpellService';
import { spellApi } from '../spellApi';

import { waitForAuth } from '@/lib/auth-gate';
import logger from '@/lib/logger';

describe('SpellApiService', () => {
  const mockFetch = vi.fn();
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

    // Reset local fallback state
    (spellApi as any).useLocalFallback = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getAllSpells', () => {
    it('should fetch all spells successfully from API', async () => {
      const apiSpell = {
        id: 's1',
        name: 'Fireball',
        level: 3,
        school: 'Evocation',
        castingTime: '1 action',
        range: '150 feet',
        duration: 'Instantaneous',
        description: 'A bright streak...',
        verbal: true,
        somatic: true,
        material: true,
        concentration: false,
        ritual: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [apiSpell],
      });

      const result = await spellApi.getAllSpells();

      expect(waitForAuth).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/spells'),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockToken}`,
          }),
        }),
      );

      expect(result[0]).toMatchObject({
        id: 's1',
        name: 'Fireball',
        materialComponents: '',
        damage: false,
        attackSave: '',
        damageEffect: '',
      });
    });

    it('should use filters in the API request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [],
      });

      await spellApi.getAllSpells({ level: 1, school: 'Abjuration' });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/spells?level=1&school=Abjuration'),
        expect.anything()
      );
    });

    it('should fallback to localSpellService when API fails', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const mockLocalSpells = [{ id: 'local-1', name: 'Local Spell' }];
      (localSpellService.getAllSpells as any).mockResolvedValueOnce(mockLocalSpells);

      const result = await spellApi.getAllSpells();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('API call failed'), expect.anything());
      expect(localSpellService.getAllSpells).toHaveBeenCalled();
      expect(result).toEqual(mockLocalSpells);
    });

    it('should immediately use local fallback if previous call failed with fetch error', async () => {
      // First call fails with fetch error
      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      (localSpellService.getAllSpells as any).mockResolvedValue([]);
      await spellApi.getAllSpells();

      expect((spellApi as any).useLocalFallback).toBe(true);

      // Second call should NOT even try fetch
      mockFetch.mockClear();
      (localSpellService.getAllSpells as any).mockResolvedValueOnce([{ id: 'local-2' }]);
      await spellApi.getAllSpells();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(localSpellService.getAllSpells).toHaveBeenCalled();
    });
  });

  describe('getClassSpells', () => {
    it('should fetch class spells from API', async () => {
      const mockResponse = [
        { id: 'c1', name: 'Light', level: 0, school: 'Evocation', castingTime: '1 action', range: 'Touch', duration: '1 hour', description: '...', verbal: true, somatic: false, material: true, concentration: false, ritual: false },
        { id: 's1', name: 'Bless', level: 1, school: 'Enchantment', castingTime: '1 action', range: '30 feet', duration: '1 minute', description: '...', verbal: true, somatic: true, material: true, concentration: true, ritual: false }
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResponse,
      });

      const result = await spellApi.getClassSpells('Cleric', 1);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/spells/class/Cleric/level/1'),
        expect.anything()
      );
      expect(result.cantrips).toHaveLength(1);
      expect(result.spells).toHaveLength(1);
      expect(result.cantrips[0].name).toBe('Light');
      expect(result.spells[0].name).toBe('Bless');
    });

    it('should fallback to localSpellService for class spells', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      (localSpellService.getClassSpells as any).mockResolvedValueOnce({ cantrips: [], spells: [] });

      await spellApi.getClassSpells('Wizard');

      expect(localSpellService.getClassSpells).toHaveBeenCalledWith('Wizard', 1);
    });
  });

  describe('getSpellProgression', () => {
    it('should fetch progression from API', async () => {
      const mockProgression = [{ character_level: 1, cantrips_known: 3 }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockProgression,
      });

      const result = await spellApi.getSpellProgression('Wizard');
      expect(result).toEqual(mockProgression);
    });
  });

  describe('getMulticlassSpellSlots', () => {
    it('should fetch multiclass slots from API', async () => {
      const mockSlots = { caster_level: 1, spell_slots_1: 2 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSlots,
      });

      const result = await spellApi.getMulticlassSpellSlots(1);
      expect(result).toEqual(mockSlots);
    });
  });

  describe('getSpellcastingClasses', () => {
    it('should fetch spellcasting classes from API', async () => {
      const mockClasses = [{ id: 'wizard', name: 'Wizard' }];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockClasses,
      });

      const result = await spellApi.getSpellcastingClasses();
      expect(result).toEqual(mockClasses);
    });
  });

  describe('calculateMulticlassCasterLevel', () => {
    it('should post data to calculate multiclass level', async () => {
      const mockResult = { totalCasterLevel: 2 };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockResult,
      });

      const input = [{ className: 'Wizard', level: 1 }, { className: 'Cleric', level: 1 }];
      const result = await spellApi.calculateMulticlassCasterLevel(input);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/spells/multiclass/calculate'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ classLevels: input }),
        })
      );
      expect(result).toEqual(mockResult);
    });
  });

  describe('getSpellById', () => {
    it('should fetch a single spell by ID', async () => {
      const mockSpell = { id: 'fireball', name: 'Fireball', level: 3, school: 'Evocation', castingTime: '1 action', range: '150 feet', duration: 'Instantaneous', description: '...', verbal: true, somatic: true, material: true, concentration: false, ritual: false };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSpell,
      });

      const result = await spellApi.getSpellById('fireball');
      expect(result.id).toBe('fireball');
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('/v1/spells/fireball'), expect.anything());
    });

    it('should throw error when both API and local fallback fail', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      (localSpellService.getSpellById as any).mockRejectedValueOnce(new Error('Not found local'));

      await expect(spellApi.getSpellById('unknown')).rejects.toThrow('Not found local');
    });
  });
});
