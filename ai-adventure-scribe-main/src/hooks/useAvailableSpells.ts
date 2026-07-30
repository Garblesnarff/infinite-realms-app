import { useState, useEffect, useMemo, useCallback } from 'react';

import type { SpellFilters } from '@/components/spells/SpellFilterPanel';
import type { Spell } from '@/types/character';

import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';

interface UseAvailableSpellsProps {
  isSpellcaster: boolean;
  className?: string;
  level: number;
}

/**
 * ⚡ Bolt: Extended Spell type with pre-calculated search string for high-performance filtering.
 */
interface ProcessedSpell extends Spell {
  _searchString: string;
}

export interface UseAvailableSpellsReturn {
  availableCantrips: Spell[];
  availableSpells: Spell[];
  isLoadingSpells: boolean;
  spellsError: string | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filters: SpellFilters;
  setFilters: (filters: SpellFilters) => void;
  filteredCantrips: Spell[];
  filteredSpells: Spell[];
  setSpellsError: (error: string | null) => void;
  refetchSpells: () => Promise<void>;
}

/**
 * ⚡ Bolt: Pre-calculates a lowercased search string for a spell.
 */
const processSpell = (spell: Spell): ProcessedSpell => ({
  ...spell,
  _searchString: `${spell.name} ${spell.description} ${spell.school}`.toLowerCase(),
});

/**
 * ⚡ Bolt: Static helper function extracted outside the hook to avoid
 * unnecessary useCallback overhead and simplify dependency tracking for pure logic.
 * Optimized to use pre-calculated search strings and avoid redundant processing.
 */
const filterSpells = (
  spells: ProcessedSpell[],
  searchLower: string,
  filters: SpellFilters,
  schoolSet: Set<string> | null,
): ProcessedSpell[] => {
  return spells.filter((spell) => {
    // Search term filter - uses pre-calculated O(1) search string
    if (searchLower && !spell._searchString.includes(searchLower)) {
      return false;
    }

    // School filter - uses Set for O(1) lookup
    if (schoolSet && !schoolSet.has(spell.school)) {
      return false;
    }

    // Component filters
    if (filters.components.verbal && !spell.components_verbal) return false;
    if (filters.components.somatic && !spell.components_somatic) return false;
    if (filters.components.material && !spell.components_material) return false;

    // Property filters
    if (filters.properties.concentration && !spell.concentration) return false;
    if (filters.properties.ritual && !spell.ritual) return false;
    if (filters.properties.damage && !spell.damage) return false;

    return true;
  });
};

/**
 * useAvailableSpells - Hook for fetching and filtering available spells
 * Extracted from useSpellSelection to handle spell discovery logic independently.
 */
export function useAvailableSpells({
  isSpellcaster,
  className,
  level,
}: UseAvailableSpellsProps): UseAvailableSpellsReturn {
  // Loading state
  const [isLoadingSpells, setIsLoadingSpells] = useState(false);
  const [spellsError, setSpellsError] = useState<string | null>(null);
  const [availableCantrips, setAvailableCantrips] = useState<ProcessedSpell[]>([]);
  const [availableSpells, setAvailableSpells] = useState<ProcessedSpell[]>([]);

  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [filters, setFilters] = useState<SpellFilters>({
    schools: [],
    components: {
      verbal: false,
      somatic: false,
      material: false,
    },
    properties: {
      concentration: false,
      ritual: false,
      damage: false,
    },
  });

  // Spell fetching function
  const fetchSpells = useCallback(async () => {
    if (!isSpellcaster || !className) {
      logger.debug(
        '🚫 [useAvailableSpells] Not a spellcaster or no class name, skipping spell fetch',
      );
      setAvailableCantrips([]);
      setAvailableSpells([]);
      return;
    }

    setIsLoadingSpells(true);
    setSpellsError(null);

    logger.debug('🔍 [useAvailableSpells] Fetching spells for class:', {
      className,
      characterLevel: level,
      isSpellcaster,
    });

    try {
      const { cantrips, spells } = await spellApi.getClassSpells(className, level);

      logger.debug('✅ [useAvailableSpells] Spells fetched successfully:', {
        className,
        cantripsFound: cantrips.length,
        spellsFound: spells.length,
        cantripNames: cantrips.slice(0, 3).map((c) => c.name),
        spellNames: spells.slice(0, 3).map((s) => s.name),
      });

      // ⚡ Bolt: Pre-process spells to include search strings upon retrieval.
      setAvailableCantrips(cantrips.map(processSpell));
      setAvailableSpells(spells.map(processSpell));
    } catch (error) {
      logger.error('Failed to fetch spells:', error);
      setSpellsError(error instanceof Error ? error.message : 'Failed to load spells');
      setAvailableCantrips([]);
      setAvailableSpells([]);
    } finally {
      setIsLoadingSpells(false);
    }
  }, [isSpellcaster, className, level]);

  // Fetch available spells from API
  useEffect(() => {
    fetchSpells();
  }, [fetchSpells]);

  /**
   * ⚡ Bolt: Consolidated filtering into a single useMemo to avoid redundant
   * processing of search terms and filter criteria.
   */
  const { filteredCantrips, filteredSpells } = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    const schoolSet = filters.schools.length > 0 ? new Set(filters.schools) : null;

    return {
      filteredCantrips: filterSpells(availableCantrips, searchLower, filters, schoolSet),
      filteredSpells: filterSpells(availableSpells, searchLower, filters, schoolSet),
    };
  }, [availableCantrips, availableSpells, searchTerm, filters]);

  return useMemo(
    () => ({
      availableCantrips,
      availableSpells,
      isLoadingSpells,
      spellsError,
      setSpellsError,
      searchTerm,
      setSearchTerm,
      filters,
      setFilters,
      filteredCantrips,
      filteredSpells,
      refetchSpells: fetchSpells,
    }),
    [
      availableCantrips,
      availableSpells,
      isLoadingSpells,
      spellsError,
      setSpellsError,
      searchTerm,
      setSearchTerm,
      filters,
      setFilters,
      filteredCantrips,
      filteredSpells,
      fetchSpells,
    ],
  );
}
