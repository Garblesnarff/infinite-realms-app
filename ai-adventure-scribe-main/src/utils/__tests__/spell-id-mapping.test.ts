import { describe, it, expect, vi, beforeEach } from 'vitest';
import logger from '@/lib/logger';
import {
  convertSpellIdsToDatabase,
  convertSpellIdsToFrontend,
  getValidSpellIds,
  hasSpellMapping,
  SPELL_ID_MAPPING,
} from '../spell-id-mapping';

// Mock the logger
vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('spell-id-mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('convertSpellIdsToDatabase', () => {
    it('should convert valid kebab-case IDs to database UUIDs', () => {
      const input = ['fireball', 'magic-missile'];
      const result = convertSpellIdsToDatabase(input);

      expect(result).toHaveLength(2);
      expect(result[0]).toBe(SPELL_ID_MAPPING['fireball']);
      expect(result[1]).toBe(SPELL_ID_MAPPING['magic-missile']);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should skip invalid IDs and log a warning', () => {
      const input = ['fireball', 'invalid-spell-id', 'shield'];
      const result = convertSpellIdsToDatabase(input);

      expect(result).toHaveLength(2);
      expect(result).toContain(SPELL_ID_MAPPING['fireball']);
      expect(result).toContain(SPELL_ID_MAPPING['shield']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No database mapping found for spell ID: invalid-spell-id'),
      );
    });

    it('should return an empty array for empty input', () => {
      const result = convertSpellIdsToDatabase([]);
      expect(result).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('convertSpellIdsToFrontend', () => {
    it('should convert valid database UUIDs to kebab-case IDs', () => {
      const fireballUuid = SPELL_ID_MAPPING['fireball'];
      const shieldUuid = SPELL_ID_MAPPING['shield'];
      const input = [fireballUuid, shieldUuid];

      const result = convertSpellIdsToFrontend(input);

      expect(result).toHaveLength(2);
      expect(result).toContain('fireball');
      expect(result).toContain('shield');
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('should skip invalid UUIDs and log a warning', () => {
      const fireballUuid = SPELL_ID_MAPPING['fireball'];
      const invalidUuid = '00000000-0000-0000-0000-000000000000';
      const input = [fireballUuid, invalidUuid];

      const result = convertSpellIdsToFrontend(input);

      expect(result).toHaveLength(1);
      expect(result).toContain('fireball');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(`No frontend mapping found for spell UUID: ${invalidUuid}`),
      );
    });

    it('should return an empty array for empty input', () => {
      const result = convertSpellIdsToFrontend([]);
      expect(result).toEqual([]);
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('getValidSpellIds', () => {
    it('should return all keys from the mapping', () => {
      const result = getValidSpellIds();
      const expectedKeys = Object.keys(SPELL_ID_MAPPING);

      expect(result).toHaveLength(expectedKeys.length);
      expectedKeys.forEach((key) => {
        expect(result).toContain(key);
      });
    });
  });

  describe('hasSpellMapping', () => {
    it('should return true for existing spell IDs', () => {
      expect(hasSpellMapping('fireball')).toBe(true);
      expect(hasSpellMapping('magic-missile')).toBe(true);
      expect(hasSpellMapping('shield')).toBe(true);
    });

    it('should return false for non-existing spell IDs', () => {
      expect(hasSpellMapping('non-existent-spell')).toBe(false);
      expect(hasSpellMapping('')).toBe(false);
      expect(hasSpellMapping('Fireball')).toBe(false); // Case sensitive check
    });
  });
});
