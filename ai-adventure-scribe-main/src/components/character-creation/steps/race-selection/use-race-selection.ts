import { useState, useMemo, useCallback } from 'react';

import { buildRaceCategories, filterRaces } from './raceFilters';

import type { CharacterRace, Subrace } from '@/types/character';
import type { AbilityScoreName } from '@/utils/racialAbilityBonuses';

import { useToast } from '@/components/ui/use-toast';
import { useCharacter } from '@/contexts/CharacterContext';
import { baseRaces } from '@/data/raceOptions';
import { useAutoScroll } from '@/hooks/use-auto-scroll';
import logger from '@/lib/logger';

export function useRaceSelection() {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const { scrollToNavigation } = useAutoScroll();

  const [selectedBaseRace, setSelectedBaseRace] = useState<CharacterRace | null>(null);
  const [showSubraces, setShowSubraces] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('compact');
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [comparisonRaces, setComparisonRaces] = useState<CharacterRace[]>([]);

  const [showHalfElfModal, setShowHalfElfModal] = useState(false);
  const [showVariantHumanModal, setShowVariantHumanModal] = useState(false);

  const raceCategories = useMemo(() => buildRaceCategories(baseRaces), []);

  const filteredRaces = useMemo(
    () => filterRaces(baseRaces, searchQuery, selectedCategory),
    [searchQuery, selectedCategory],
  );

  const toggleFavorite = useCallback((raceId: string) => {
    setFavorites((prev) => {
      const newFavorites = new Set(prev);
      if (newFavorites.has(raceId)) {
        newFavorites.delete(raceId);
      } else {
        newFavorites.add(raceId);
      }
      return newFavorites;
    });
  }, []);

  const addToComparison = useCallback((race: CharacterRace) => {
    setComparisonRaces((prev) => {
      if (prev.length < 3 && !prev.find((r) => r.id === race.id)) {
        return [...prev, race];
      }
      return prev;
    });
  }, []);

  const removeFromComparison = useCallback((raceId: string) => {
    setComparisonRaces((prev) => prev.filter((r) => r.id !== raceId));
  }, []);

  const handleBaseRaceSelect = useCallback((baseRace: CharacterRace) => {
    logger.info('Selecting base race:', baseRace);
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { race: baseRace, subrace: null },
    });
    setSelectedBaseRace(baseRace);

    if (baseRace.id === 'half-elf') {
      setShowHalfElfModal(true);
      return;
    }

    if (baseRace.subraces && baseRace.subraces.length > 0) {
      setShowSubraces(true);
      toast({
        title: 'Base Race Selected',
        description: `You have chosen ${baseRace.name}. Now select a subrace.`,
        duration: 1000,
      });
    } else {
      toast({
        title: 'Race Selected',
        description: `You have chosen the ${baseRace.name} race.`,
        duration: 1000,
      });
      scrollToNavigation();
    }
  }, [dispatch, toast, scrollToNavigation]);

  const handleSubraceSelect = useCallback((subrace: Subrace) => {
    logger.info('Selecting subrace:', subrace);

    if (subrace.id === 'variant-human') {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { subrace },
      });
      setShowSubraces(false);
      setShowVariantHumanModal(true);
      return;
    }

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { subrace },
    });
    setShowSubraces(false);
    toast({
      title: 'Subrace Selected',
      description: `You have chosen ${subrace.name}.`,
      duration: 1000,
    });
    scrollToNavigation();
  }, [dispatch, toast, scrollToNavigation]);

  const handleHalfElfAbilityChoice = useCallback((abilities: [AbilityScoreName, AbilityScoreName]) => {
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        racialAbilityChoices: {
          ...state.character?.racialAbilityChoices,
          halfElf: abilities,
        },
      },
    });
    toast({
      title: 'Abilities Selected',
      description: `You have chosen +1 to ${abilities[0]} and ${abilities[1]}.`,
      duration: 2000,
    });
    scrollToNavigation();
  }, [dispatch, state.character?.racialAbilityChoices, toast, scrollToNavigation]);

  const handleVariantHumanChoice = useCallback((
    abilities: [AbilityScoreName, AbilityScoreName],
    feat: string,
  ) => {
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: {
        racialAbilityChoices: {
          ...state.character?.racialAbilityChoices,
          variantHuman: abilities,
        },
        feats: [feat],
      },
    });

    const featName = feat
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');

    toast({
      title: 'Variant Human Customization Complete',
      description: `You have chosen +1 to ${abilities[0]} and ${abilities[1]}, plus the ${featName} feat.`,
      duration: 3000,
    });
    scrollToNavigation();
  }, [dispatch, state.character?.racialAbilityChoices, toast, scrollToNavigation]);

  return {
    state,
    selectedBaseRace,
    setSelectedBaseRace,
    showSubraces,
    setShowSubraces,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    viewMode,
    setViewMode,
    favorites,
    comparisonRaces,
    setComparisonRaces,
    showHalfElfModal,
    setShowHalfElfModal,
    showVariantHumanModal,
    setShowVariantHumanModal,
    raceCategories,
    filteredRaces,
    toggleFavorite,
    addToComparison,
    removeFromComparison,
    handleBaseRaceSelect,
    handleSubraceSelect,
    handleHalfElfAbilityChoice,
    handleVariantHumanChoice,
  };
}
