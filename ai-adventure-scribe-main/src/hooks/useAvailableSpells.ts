import { useState, useEffect, useMemo, useCallback } from 'react';

import type { SpellFilters } from '@/components/spells/SpellFilterPanel';
import type { Spell } from '@/types/character';

import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';

interface UseAvailableSpellsProps {
  isSpellcaster: boolean;
  className?: string;
  level: number;
  /**
   * #320 CR-008: also fetch this class's cantrips for racial bonus-cantrip
   * options. A High Elf Ranger's bonus pick comes from the *wizard* list, but
   * the class list is empty for a non-spellcaster, so the tab showed "No
   * spells available". When it matches className (case-insensitive) the main
   * list is reused and no second fetch happens.
   */
  bonusCantripClassName?: string;
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
  /** #320 CR-008: cantrips of bonusCantripClassName (e.g. wizard), unfiltered. */
  bonusCantrips: Spell[];
  isLoadingSpells: boolean;
  spellsError: string | null;
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filters: SpellFilters;
  setFilters: (filters: SpellFilters) => void;
  filteredCantrips: Spell[];
  filteredSpells: Spell[];
  /** #320 CR-008: bonusCantrips run through the same search/filter as the tabs. */
  filteredBonusCantrips: Spell[];
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
  bonusCantripClassName,
}: UseAvailableSpellsProps): UseAvailableSpellsReturn {
  // Loading state
  const [isLoadingSpells, setIsLoadingSpells] = useState(false);
  const [spellsError, setSpellsError] = useState<string | null>(null);
  const [availableCantrips, setAvailableCantrips] = useState<ProcessedSpell[]>([]);
  const [availableSpells, setAvailableSpells] = useState<ProcessedSpell[]>([]);
  // #320 CR-008: racial bonus-cantrip options from another class's list.
  const [bonusCantrips, setBonusCantrips] = useState<ProcessedSpell[]>([]);

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

  // #320 CR-008: fetch the bonus-cantrip class's cantrips independently of the
  // class gate above — a High Elf Ranger is not a spellcaster, so the main
  // fetch is skipped, but the wizard bonus pick still needs its list.
  const bonusNeedsFetch =
    !!bonusCantripClassName &&
    bonusCantripClassName.toLowerCase() !== (className || '').toLowerCase();
  const fetchBonusCantrips = useCallback(async () => {
    if (!bonusNeedsFetch || !bonusCantripClassName) {
      setBonusCantrips([]);
      return;
    }
    try {
      const { cantrips } = await spellApi.getClassSpells(bonusCantripClassName, level);
      setBonusCantrips(cantrips.map(processSpell));
    } catch (error) {
      logger.error('Failed to fetch bonus cantrips:', error);
      setBonusCantrips([]);
    }
  }, [bonusNeedsFetch, bonusCantripClassName, level]);

  useEffect(() => {
    fetchBonusCantrips();
  }, [fetchBonusCantrips]);

  /**
   * ⚡ Bolt: Consolidated filtering into a single useMemo to avoid redundant
   * processing of search terms and filter criteria.
   */
  // #320 CR-008: when the bonus class is the character's own class, the main
  // cantrip list already is the bonus list — no second fetch, no divergence.
  const bonusSourceCantrips =
    bonusCantripClassName && !bonusNeedsFetch ? availableCantrips : bonusCantrips;
  const { filteredCantrips, filteredSpells, filteredBonusCantrips } = useMemo(() => {
    const searchLower = searchTerm.toLowerCase();
    const schoolSet = filters.schools.length > 0 ? new Set(filters.schools) : null;

    return {
      filteredCantrips: filterSpells(availableCantrips, searchLower, filters, schoolSet),
      filteredSpells: filterSpells(availableSpells, searchLower, filters, schoolSet),
      filteredBonusCantrips: filterSpells(bonusSourceCantrips, searchLower, filters, schoolSet),
    };
  }, [availableCantrips, availableSpells, bonusSourceCantrips, searchTerm, filters]);

  return useMemo(
    () => ({
      availableCantrips,
      availableSpells,
      bonusCantrips: bonusNeedsFetch ? bonusCantrips : availableCantrips,
      isLoadingSpells,
      spellsError,
      setSpellsError,
      searchTerm,
      setSearchTerm,
      filters,
      setFilters,
      filteredCantrips,
      filteredSpells,
      filteredBonusCantrips,
      refetchSpells: fetchSpells,
    }),
    [
      availableCantrips,
      availableSpells,
      bonusCantrips,
      bonusNeedsFetch,
      isLoadingSpells,
      spellsError,
      setSpellsError,
      searchTerm,
      setSearchTerm,
      filters,
      setFilters,
      filteredCantrips,
      filteredSpells,
      filteredBonusCantrips,
      fetchSpells,
    ],
  );
}
