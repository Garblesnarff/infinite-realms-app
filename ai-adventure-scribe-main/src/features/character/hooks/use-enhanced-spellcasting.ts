import { useState, useEffect, useCallback, useMemo } from 'react';

import type { Character, Spell } from '@/types/character';

import { metamagicOptions } from '@/data/spellcastingFeatures';
import logger from '@/lib/logger';
import { spellApi } from '@/services/spellApi';
import { calculateProficiencyBonus } from '@/utils/character/basic-math';
import { calculateSpellSlots } from '@/utils/spell-management';

export interface SpellSlots {
  [key: number]: { total: number; used: number };
}

export interface UseEnhancedSpellcastingReturn {
  allSpells: Spell[];
  isLoadingSpells: boolean;
  spellAttackBonus: number;
  spellSaveDC: number;
  spellcastingAbility: string | undefined;
  spellcastingMod: number;
  proficiencyBonus: number;
  spellSlots: SpellSlots;
  pactSlots: { current: number; maximum: number; level: number };
  sorceryPoints: { current: number; maximum: number };
  hasSpellcasting: boolean;
  hasPactMagic: boolean;
  hasMetamagic: boolean;
  canCastRituals: boolean;
  knownCantrips: Spell[];
  knownSpells: Spell[];
  preparedSpells: Spell[];
  pactMagicSpells: Spell[];
  ritualSpells: Spell[];
  availableMetamagic: typeof metamagicOptions;
  consumeSpellSlot: (level: number) => void;
  restoreSpellSlot: (level: number) => void;
  consumePactSlot: () => void;
  spendSorceryPoints: (amount: number) => void;
  longRest: () => void;
  shortRest: () => void;
}

/**
 * useEnhancedSpellcasting Hook
 * Extracted from EnhancedSpellsTab.tsx
 * Manages D&D 5e enhanced spellcasting state and logic
 */
export function useEnhancedSpellcasting(
  character: Character,
  _onUpdate?: (updatedCharacter: Character) => void,
): UseEnhancedSpellcastingReturn {
  // State for fetched spells
  const [allSpells, setAllSpells] = useState<Spell[]>([]);
  const [isLoadingSpells, setIsLoadingSpells] = useState(true);

  // Fetch all spells on component mount
  useEffect(() => {
    const fetchSpells = async (): Promise<void> => {
      try {
        const spells = await spellApi.getAllSpells();
        setAllSpells(spells);
      } catch (error) {
        logger.error('Failed to fetch spells:', error);
      } finally {
        setIsLoadingSpells(false);
      }
    };

    fetchSpells();
  }, []);

  // Calculate spellcasting info
  const characterClass = character?.class;
  const level = character?.level || 1;
  const spellcastingAbility = characterClass?.spellcasting?.ability;
  const spellcastingMod = spellcastingAbility
    ? character?.abilityScores?.[spellcastingAbility]?.modifier || 0
    : 0;
  const proficiencyBonus = calculateProficiencyBonus(level);
  const spellAttackBonus = spellcastingMod + proficiencyBonus;
  const spellSaveDC = 8 + spellcastingMod + proficiencyBonus;

  // Derive initial spell slots from character data
  const derivedSlots = useMemo(() => {
    const slots = calculateSpellSlots(character);
    const result: SpellSlots = {};
    Object.entries(slots).forEach(([level, config]) => {
      const lvl = parseInt(level);
      if (config.max > 0) {
        result[lvl] = {
          total: config.max,
          used: config.max - config.current,
        };
      }
    });
    return result;
  }, [character]);

  // Spell slot management
  const [spellSlots, setSpellSlots] = useState<SpellSlots>(derivedSlots);

  // Sync spell slots if character changes (e.g. after rest or level up)
  useEffect(() => {
    setSpellSlots(derivedSlots);
  }, [derivedSlots]);

  // Pact magic management
  const [pactSlots, setPactSlots] = useState({
    current: character?.pactSlots?.current || 0,
    maximum: character?.pactSlots?.maximum || 0,
    level: character?.pactSlots?.level || 1,
  });

  // Sync pact slots
  useEffect(() => {
    setPactSlots({
      current: character?.pactSlots?.current || 0,
      maximum: character?.pactSlots?.maximum || 0,
      level: character?.pactSlots?.level || 1,
    });
  }, [character?.pactSlots]);

  // Sorcery points management
  const [sorceryPoints, setSorceryPoints] = useState({
    current: character?.sorceryPoints?.current || 0,
    maximum: character?.sorceryPoints?.maximum || 0,
  });

  // Sync sorcery points
  useEffect(() => {
    setSorceryPoints({
      current: character?.sorceryPoints?.current || 0,
      maximum: character?.sorceryPoints?.maximum || 0,
    });
  }, [character?.sorceryPoints]);

  // Check for spellcasting features
  const hasSpellcasting = characterClass?.spellcasting !== undefined;
  const hasPactMagic = characterClass?.spellcasting?.pactMagic || false;
  const hasMetamagic = character?.metamagicOptions && character.metamagicOptions.length > 0;
  const canCastRituals = characterClass?.spellcasting?.ritualCasting || false;

  // Derived spell lists
  const knownCantrips = !isLoadingSpells
    ? (character?.cantrips || [])
        .map((cantripId) => allSpells.find((spell: Spell) => spell.id === cantripId))
        .filter((spell): spell is Spell => !!spell)
    : [];

  const knownSpells = !isLoadingSpells
    ? (character?.knownSpells || [])
        .map((spellId) => allSpells.find((spell: Spell) => spell.id === spellId))
        .filter((spell): spell is Spell => !!spell)
    : [];

  const preparedSpells = !isLoadingSpells
    ? (character?.preparedSpells || [])
        .map((spellId) => allSpells.find((spell: Spell) => spell.id === spellId))
        .filter((spell): spell is Spell => !!spell)
    : [];

  const pactMagicSpells = !isLoadingSpells
    ? (character?.pactMagicSpells || [])
        .map((spellId) => allSpells.find((spell: Spell) => spell.id === spellId))
        .filter((spell): spell is Spell => !!spell)
    : [];

  const ritualSpells = !isLoadingSpells
    ? allSpells.filter(
        (spell: Spell) =>
          spell.ritual &&
          (character?.ritualSpells?.includes(spell.id) ||
            preparedSpells.some((p) => p?.id === spell.id)),
      )
    : [];

  const availableMetamagic = metamagicOptions.filter((option) =>
    character?.metamagicOptions?.includes(option.id),
  );

  /**
   * Spell slot management functions
   */
  const consumeSpellSlot = useCallback(
    (level: number) => {
      if (spellSlots[level] && spellSlots[level].used < spellSlots[level].total) {
        setSpellSlots((prev) => ({
          ...prev,
          [level]: {
            ...prev[level],
            used: prev[level].used + 1,
          },
        }));
      }
    },
    [spellSlots],
  );

  const restoreSpellSlot = useCallback(
    (level: number) => {
      if (spellSlots[level] && spellSlots[level].used > 0) {
        setSpellSlots((prev) => ({
          ...prev,
          [level]: {
            ...prev[level],
            used: prev[level].used - 1,
          },
        }));
      }
    },
    [spellSlots],
  );

  const longRest = useCallback(() => {
    setSpellSlots((prev) => {
      const restored = { ...prev };
      Object.keys(restored).forEach((level) => {
        restored[parseInt(level)].used = 0;
      });
      return restored;
    });

    setSorceryPoints((prev) => ({
      ...prev,
      current: prev.maximum,
    }));
  }, []);

  const shortRest = useCallback(() => {
    if (hasPactMagic) {
      setPactSlots((prev) => ({
        ...prev,
        current: prev.maximum,
      }));
    }
  }, [hasPactMagic]);

  /**
   * Pact magic functions
   */
  const consumePactSlot = useCallback(() => {
    if (pactSlots.current > 0) {
      setPactSlots((prev) => ({
        ...prev,
        current: prev.current - 1,
      }));
    }
  }, [pactSlots]);

  /**
   * Sorcery point functions
   */
  const spendSorceryPoints = useCallback(
    (amount: number) => {
      if (sorceryPoints.current >= amount) {
        setSorceryPoints((prev) => ({
          ...prev,
          current: prev.current - amount,
        }));
      }
    },
    [sorceryPoints],
  );

  return {
    allSpells,
    isLoadingSpells,
    spellAttackBonus,
    spellSaveDC,
    spellcastingAbility,
    spellcastingMod,
    proficiencyBonus,
    spellSlots,
    pactSlots,
    sorceryPoints,
    hasSpellcasting,
    hasPactMagic,
    hasMetamagic,
    canCastRituals,
    knownCantrips,
    knownSpells,
    preparedSpells,
    pactMagicSpells,
    ritualSpells,
    availableMetamagic,
    consumeSpellSlot,
    restoreSpellSlot,
    consumePactSlot,
    spendSorceryPoints,
    longRest,
    shortRest,
  };
}
