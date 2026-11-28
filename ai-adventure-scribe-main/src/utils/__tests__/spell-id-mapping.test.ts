import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RETIRED_SPELL_UUIDS } from '../../../shared/spell-aliases';
import {
  convertSpellIdsToDatabase,
  convertSpellIdsToFrontend,
  getValidSpellIds,
  hasSpellMapping,
  SPELL_ID_MAPPING,
} from '../spell-id-mapping';

import { allSpells } from '@/data/spellOptions';
import logger from '@/lib/logger';

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
    it('preserves the exact standard SRD slugs returned by every class API', () => {
      const warningSlugs = [
        'acid-splash',
        'chill-touch',
        'dancing-lights',
        'alarm',
        'light',
        'bane',
        'guidance',
      ];

      expect(convertSpellIdsToFrontend(warningSlugs)).toEqual(warningSlugs);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('preserves every canonical frontend spell slug', () => {
      const canonicalSlugs = allSpells.map((spell) => spell.id);

      expect(convertSpellIdsToFrontend(canonicalSlugs)).toEqual(canonicalSlugs);
      expect(logger.warn).not.toHaveBeenCalled();
    });

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
        expect.stringContaining(`No frontend mapping found for spell identifier: ${invalidUuid}`),
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

  describe('one canonical spell id (#254)', () => {
    // The seed files are the single source of truth for the catalog rows:
    // parse them in-test like the StarterTemplateCard parity test does,
    // instead of copying a fixture that can drift.
    const SEED_DIR = path.resolve(process.cwd(), 'db', 'migrations');
    const seedSql = ['20261021_seed_spell_catalog.sql', '20261021_seed_thaumaturgy.sql']
      .map((file) => readFileSync(path.join(SEED_DIR, file), 'utf8'))
      .join('\n');
    const seedRowIds = new Set(
      [...seedSql.matchAll(/\(\s*'([0-9a-f-]{36})'\s*,\s*'((?:[^']|'')+)'/g)].map(
        ([, uuid]) => uuid,
      ),
    );

    it('every mapping UUID resolves to a catalog row in the seed files', () => {
      // Fail loudly if the parse ever comes back empty instead of passing vacuously.
      expect(seedRowIds.size).toBeGreaterThan(300);
      const unresolved = Object.entries(SPELL_ID_MAPPING).filter(
        ([, uuid]) => !seedRowIds.has(uuid),
      );
      expect(unresolved).toEqual([]);
    });

    it('has one catalog entry per spell (no possessive-stripped duplicate names)', () => {
      const stripped = (name: string): string => {
        const lower = name.toLowerCase();
        const possessive = lower.indexOf("'s ");
        return possessive >= 0 ? lower.slice(possessive + 3) : lower;
      };
      const seen = new Map<string, string>();
      const duplicates: string[] = [];
      for (const spell of allSpells) {
        const key = stripped(spell.name);
        if (seen.has(key)) {
          duplicates.push(`${seen.get(key)} vs ${spell.name}`);
        } else {
          seen.set(key, spell.name);
        }
      }
      expect(duplicates).toEqual([]);
    });

    it('saves a possessive alias under the canonical UUID', () => {
      const canonical = SPELL_ID_MAPPING['hideous-laughter'];
      expect(canonical).toBeDefined();
      expect(convertSpellIdsToDatabase(['tashas-hideous-laughter'])).toEqual([canonical]);
      expect(convertSpellIdsToDatabase(['hideous-laughter'])).toEqual([canonical]);
      expect(convertSpellIdsToDatabase(['tensers-floating-disk'])).toEqual([
        SPELL_ID_MAPPING['floating-disk'],
      ]);
      expect(convertSpellIdsToDatabase(['floating-disk'])).toEqual([
        SPELL_ID_MAPPING['floating-disk'],
      ]);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('counts a possessive alias as mapped', () => {
      expect(hasSpellMapping('tashas-hideous-laughter')).toBe(true);
      expect(hasSpellMapping('tensers-floating-disk')).toBe(true);
    });

    it('reads a retired duplicate UUID as the canonical spell', () => {
      for (const [retiredUuid, canonicalSlug] of Object.entries(RETIRED_SPELL_UUIDS)) {
        expect(convertSpellIdsToFrontend([retiredUuid])).toEqual([canonicalSlug]);
      }
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('saves a raw retired duplicate UUID under the canonical UUID', () => {
      for (const [retiredUuid, canonicalSlug] of Object.entries(RETIRED_SPELL_UUIDS)) {
        expect(convertSpellIdsToDatabase([retiredUuid])).toEqual([SPELL_ID_MAPPING[canonicalSlug]]);
        expect(hasSpellMapping(retiredUuid)).toBe(true);
      }
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });
});
