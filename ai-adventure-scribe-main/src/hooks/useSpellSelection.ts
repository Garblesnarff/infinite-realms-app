import { useState, useEffect, useMemo } from 'react';

import type { SpellFilters } from '@/components/spells/SpellFilterPanel';
import type { Spell, Character } from '@/types/character';
import type { SpellValidationResult } from '@/utils/spell-validation';

import { useCharacter } from '@/contexts/CharacterContext';
import { useAvailableSpells } from '@/hooks/useAvailableSpells';
import logger from '@/lib/logger';
import { characterSpellService } from '@/services/characterSpellApi';
import {
  validateSpellSelection,
  getSpellcastingInfo,
  getRacialSpells,
  validateSpellSelectionAsync,
} from '@/utils/spell-validation';

interface UseSpellSelectionReturn {
  // Character and class info
  character: Character | null;
  isSpellcaster: boolean;
  spellcastingInfo: ReturnType<typeof getSpellcastingInfo>;

  // Available spells
  availableCantrips: Spell[];
  availableSpells: Spell[];
  racialSpells: ReturnType<typeof getRacialSpells>;

  // Loading states
  isLoadingSpells: boolean;
  spellsError: string | null;

  // Current selections
  selectedCantrips: string[];
  selectedSpells: string[];

  // Selection actions
  toggleCantrip: (cantripId: string) => void;
  toggleSpell: (spellId: string) => void;
  clearSelections: () => void;

  // Filtering
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filters: SpellFilters;
  setFilters: (filters: SpellFilters) => void;
  filteredCantrips: Spell[];
  filteredSpells: Spell[];

  // Validation
  validation: SpellValidationResult;
  canProceed: boolean;

  // Save to character and database
  updateCharacterSpells: () => Promise<void>;
  isSavingSpells: boolean;

  // Retry functionality
  refetchSpells: () => Promise<void>;
}

/**
 * useSpellSelection - Custom hook for managing spell selection
 * Features:
 * - Centralized spell selection state management
 * - Real-time validation with D&D 5E rules
 * - Search and filtering functionality
 * - Integration with character context
 * - Racial spell handling
 * - Validation feedback
 */
export function useSpellSelection(): UseSpellSelectionReturn {
  const { state, dispatch } = useCharacter();
  const character = state.character;

  // Character and spellcasting info
  const currentClass = character?.class;
  const isSpellcaster = !!currentClass?.spellcasting;
  const spellcastingInfo = useMemo(() => {
    return currentClass ? getSpellcastingInfo(currentClass, character?.level || 1) : null;
  }, [currentClass, character?.level]);

  // Discover available spells using the extracted hook
  const {
    availableCantrips,
    availableSpells,
    isLoadingSpells,
    spellsError,
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    filteredCantrips,
    filteredSpells,
    setSpellsError,
    refetchSpells,
  } = useAvailableSpells({
    isSpellcaster,
    className: currentClass?.name,
    level: character?.level || 1,
  });

  // Selection state
  const [selectedCantrips, setSelectedCantrips] = useState<string[]>([]);
  const [selectedSpells, setSelectedSpells] = useState<string[]>([]);
  const [isSavingSpells, setIsSavingSpells] = useState(false);

  // Initialize from character data
  useEffect(() => {
    if (character) {
      logger.debug('🎯 [useSpellSelection] Initializing spell selection from character:', {
        characterId: character.id,
        cantrips: character.cantrips,
        knownSpells: character.knownSpells,
      });
      setSelectedCantrips(character.cantrips || []);
      setSelectedSpells(character.knownSpells || []);
    }
  }, [character?.id]); // Only reset when character changes

  // Racial spells
  const racialSpells = useMemo(() => {
    if (!character) {
      return { cantrips: [], spells: [], bonusCantrips: 0 };
    }

    return getRacialSpells(character.race?.name || '', character.subrace || undefined);
  }, [character?.race?.name, character?.subrace]);

  // Selection actions
  const toggleCantrip = (cantripId: string): void => {
    setSelectedCantrips((prev) => {
      if (prev.includes(cantripId)) {
        return prev.filter((id) => id !== cantripId);
      } else {
        // Check if we've reached the limit
        const maxCantrips =
          (spellcastingInfo?.cantripsKnown || 0) +
          racialSpells.cantrips.length +
          racialSpells.bonusCantrips;
        if (prev.length >= maxCantrips) {
          return prev; // Don't add if at limit
        }
        return [...prev, cantripId];
      }
    });
  };

  const toggleSpell = (spellId: string): void => {
    logger.debug('🪄 [useSpellSelection] toggleSpell called:', spellId);
    setSelectedSpells((prev) => {
      const isRemoving = prev.includes(spellId);
      const maxSpells = spellcastingInfo?.spellsKnown || 0;

      let newSelection: string[];
      if (isRemoving) {
        newSelection = prev.filter((id) => id !== spellId);
      } else {
        // Check if we've reached the limit
        if (prev.length >= maxSpells) {
          logger.warn('🚫 [useSpellSelection] Spell limit reached, cannot add more spells');
          return prev; // Don't add if at limit
        }
        newSelection = [...prev, spellId];
      }

      logger.debug('🪄 [useSpellSelection] selectedSpells updated:', {
        action: isRemoving ? 'removed' : 'added',
        spellId,
        previousCount: prev.length,
        newCount: newSelection.length,
        newSelection,
      });

      return newSelection;
    });
  };

  const clearSelections = (): void => {
    setSelectedCantrips([]);
    setSelectedSpells([]);
  };

  // Validation
  const [validation, setValidation] = useState<ReturnType<typeof validateSpellSelection>>({
    valid: false,
    errors: [],
    warnings: [],
  });
  const [isValidating, setIsValidating] = useState(false);

  // Perform async validation when character, selections, or available spells change
  useEffect(() => {
    let mounted = true;

    const runValidation = async (): Promise<void> => {
      if (!character) {
        setValidation({ valid: false, errors: [], warnings: [] });
        return;
      }

      setIsValidating(true);

      const availableCantripIds = availableCantrips.map((c) => c.id);
      const availableSpellIds = availableSpells.map((s) => s.id);

      try {
        const result = await validateSpellSelectionAsync(
          character,
          selectedCantrips,
          selectedSpells,
          availableCantripIds,
          availableSpellIds,
        );
        if (mounted) setValidation(result);
      } catch (error) {
        logger.error('Async spell validation failed:', error);
        // Fall back to synchronous validation
        const result = validateSpellSelection(
          character,
          selectedCantrips,
          selectedSpells,
          availableCantripIds,
          availableSpellIds,
        );
        if (mounted) setValidation(result);
      } finally {
        if (mounted) setIsValidating(false);
      }
    };

    runValidation();

    return () => {
      mounted = false;
    };
  }, [character, selectedCantrips, selectedSpells, availableCantrips, availableSpells]);

  const canProceed = validation.valid && !isValidating;

  // Save to character and database
  const updateCharacterSpells = async (): Promise<void> => {
    if (!character || !character.id) {
      return;
    }

    // Do not save or dispatch if current selection is invalid
    if (!validation.valid) {
      return;
    }

    setIsSavingSpells(true);
    try {
      // Combine cantrips and spells for API call
      const allSpells = [...selectedCantrips, ...selectedSpells];

      // Save to database first
      await characterSpellService.saveCharacterSpells(character.id, {
        spells: allSpells,
        className: character.class?.name || '',
      });

      // Then update local context
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          cantrips: selectedCantrips,
          knownSpells: selectedSpells,
        },
      });
    } catch (error) {
      logger.error('Failed to save character spells:', error);
      setSpellsError(error instanceof Error ? error.message : 'Failed to save spells');
      throw error; // Re-throw so calling components can handle
    } finally {
      setIsSavingSpells(false);
    }
  };

  // Auto-save selections to character immediately when they change
  useEffect(() => {
    if (character) {
      // Only log when there are actual changes to reduce noise
      const currentCantrips = character.cantrips || [];
      const currentSpells = character.knownSpells || [];
      const cantripsChanged =
        JSON.stringify([...selectedCantrips].sort()) !==
        JSON.stringify([...currentCantrips].sort());
      const spellsChanged =
        JSON.stringify([...selectedSpells].sort()) !== JSON.stringify([...currentSpells].sort());

      if (cantripsChanged || spellsChanged) {
        logger.debug('🔄 [useSpellSelection] Auto-saving spell selections to character context:', {
          characterId: character.id,
          cantrips: selectedCantrips,
          knownSpells: selectedSpells,
          cantripCount: selectedCantrips.length,
          spellCount: selectedSpells.length,
        });
        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: {
            cantrips: selectedCantrips,
            knownSpells: selectedSpells,
          },
        });
      }
    }
  }, [selectedCantrips, selectedSpells, character, dispatch]);

  return {
    // Character and class info
    character,
    isSpellcaster,
    spellcastingInfo,

    // Available spells
    availableCantrips,
    availableSpells,
    racialSpells,

    // Loading states
    isLoadingSpells,
    spellsError,

    // Current selections
    selectedCantrips,
    selectedSpells,

    // Selection actions
    toggleCantrip,
    toggleSpell,
    clearSelections,

    // Filtering
    searchTerm,
    setSearchTerm,
    filters,
    setFilters,
    filteredCantrips,
    filteredSpells,

    // Validation
    validation,
    canProceed,

    // Save to character and database
    updateCharacterSpells,
    isSavingSpells,

    // Retry functionality
    refetchSpells,
  };
}
