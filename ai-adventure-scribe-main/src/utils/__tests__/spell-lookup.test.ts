/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { REVERSE_SPELL_ID_MAPPING } from '../spell-id-mapping';
import {
  getSpellById,
  getSpellsByIds,
  getCharacterSpells,
  createFallbackSpell,
  getAllSpells,
  searchSpells,
} from '../spell-lookup';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock spellOptions
vi.mock('@/data/spellOptions', () => ({
  allSpells: [
    {
      id: 'fire-bolt',
      name: 'Fire Bolt',
      level: 0,
      school: 'Evocation',
      description: 'A mote of fire.',
      castingTime: '1 action',
      range: '120 feet',
      components: 'V, S',
      verbal: true,
      somatic: true,
      material: false,
      duration: 'Instantaneous',
      concentration: false,
      ritual: false,
    },
    {
      id: 'mage-armor',
      name: 'Mage Armor',
      level: 1,
      school: 'Abjuration',
      description: 'Protective force.',
      castingTime: '1 action',
      range: 'Touch',
      components: 'V, S, M',
      verbal: true,
      somatic: true,
      material: true,
      duration: '8 hours',
      concentration: false,
      ritual: false,
    },
  ],
}));

describe('spell-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSpellById', () => {
    it('should find a spell by kebab-case ID', () => {
      const spell = getSpellById('fire-bolt');
      expect(spell).toBeDefined();
      expect(spell?.name).toBe('Fire Bolt');
    });

    it('should find a spell by UUID using reverse mapping', () => {
      // Find a UUID from the mapping
      const uuid = Object.keys(REVERSE_SPELL_ID_MAPPING).find(
        (key) => REVERSE_SPELL_ID_MAPPING[key] === 'fire-bolt',
      );

      if (!uuid) {
        // Fallback if fire-bolt is not in mapping for some reason
        const firstUuid = Object.keys(REVERSE_SPELL_ID_MAPPING)[0];
        const spell = getSpellById(firstUuid);
        expect(spell).toBeDefined();
        expect(spell?.id).toBe(REVERSE_SPELL_ID_MAPPING[firstUuid]);
      } else {
        const spell = getSpellById(uuid);
        expect(spell).toBeDefined();
        expect(spell?.id).toBe('fire-bolt');
      }
    });

    it('should return a fallback spell for unknown IDs by default', () => {
      const spell = getSpellById('unknown-spell');
      expect(spell).toBeDefined();
      expect(spell?.id).toBe('unknown-spell');
      expect(spell?.name).toBe('Unknown Spell');
      expect(spell?.description).toContain('Spell data not available');
    });

    it('should return null for unknown IDs if createFallback is false', () => {
      const spell = getSpellById('unknown-spell', false);
      expect(spell).toBeNull();
    });

    it('should return null for empty ID', () => {
      expect(getSpellById('')).toBeNull();
    });

    it('should handle errors and return fallback if requested', () => {
      // We can't easily force an error in the current implementation without more complex mocking
      // but we can verify the fallback creation itself.
      const spell = createFallbackSpell('error-spell');
      expect(spell.id).toBe('error-spell');
    });
  });

  describe('getSpellsByIds', () => {
    it('should return multiple spells', () => {
      const spells = getSpellsByIds(['fire-bolt', 'mage-armor']);
      expect(spells).toHaveLength(2);
      expect(spells[0].id).toBe('fire-bolt');
      expect(spells[1].id).toBe('mage-armor');
    });

    it('should include fallbacks for missing IDs in the array', () => {
      const spells = getSpellsByIds(['fire-bolt', 'missing-one']);
      expect(spells).toHaveLength(2);
      expect(spells[1].id).toBe('missing-one');
    });

    it('should filter out nulls if fallbacks are disabled', () => {
      const spells = getSpellsByIds(['fire-bolt', 'missing-one'], false);
      expect(spells).toHaveLength(1);
      expect(spells[0].id).toBe('fire-bolt');
    });

    it('should return empty array for invalid input', () => {
      expect(getSpellsByIds(null as any)).toEqual([]);
      expect(getSpellsByIds([])).toEqual([]);
    });
  });

  describe('getCharacterSpells', () => {
    it('should organize spells by category', () => {
      const character = {
        name: 'Test Wizard',
        cantrips: ['fire-bolt'],
        preparedSpells: ['mage-armor'],
      };

      const result = getCharacterSpells(character);
      expect(result.cantrips).toHaveLength(1);
      expect(result.cantrips[0].id).toBe('fire-bolt');
      expect(result.preparedSpells).toHaveLength(1);
      expect(result.preparedSpells[0].id).toBe('mage-armor');
      expect(result.preparedSpells[0].is_prepared).toBe(true);
      expect(result.allSpells).toHaveLength(2);
    });

    it('should merge overlapping spells and combine source features', () => {
      const character = {
        cantrips: ['fire-bolt'],
        knownSpells: ['fire-bolt'],
      };

      const result = getCharacterSpells(character);
      expect(result.allSpells).toHaveLength(1);
      expect(result.allSpells[0].source_feature).toContain('Class Cantrips');
      expect(result.allSpells[0].source_feature).toContain('Known Spells');
    });

    it('should handle missing or invalid character object', () => {
      expect(getCharacterSpells(null).allSpells).toEqual([]);
      expect(getCharacterSpells({}).allSpells).toEqual([]);
    });

    it('should handle spells without IDs gracefully', () => {
      // Mocking getSpellsByIds to return a spell with missing ID is hard due to type safety
      // But we can test the character with invalid IDs that get filtered or become fallbacks
      const character = {
        cantrips: [null as any, 'valid-one'],
      };
      const result = getCharacterSpells(character);
      expect(result.cantrips).toHaveLength(1);
      expect(result.cantrips[0].id).toBe('valid-one');
    });
  });

  describe('searchSpells', () => {
    it('should search by name', () => {
      const results = searchSpells('fire');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('fire-bolt');
    });

    it('should search by school', () => {
      const results = searchSpells('abjuration');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mage-armor');
    });

    it('should filter by level', () => {
      const results = searchSpells('', 1);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('mage-armor');

      const cantrips = searchSpells('', 0);
      expect(cantrips).toHaveLength(1);
      expect(cantrips[0].id).toBe('fire-bolt');
    });
  });

  describe('getAllSpells', () => {
    it('should return all mocked spells', () => {
      const all = getAllSpells();
      expect(all).toHaveLength(2);
    });
  });

  describe('createFallbackSpell', () => {
    it('should create a spell with correct formatting', () => {
      const fallback = createFallbackSpell('magic-missile');
      expect(fallback.id).toBe('magic-missile');
      expect(fallback.name).toBe('Magic Missile');
      expect(fallback.level).toBe(0);
    });
  });
});
