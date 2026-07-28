import { useState, useMemo, useCallback } from 'react';

import type { AbilityScores } from '@/types/character';

import { useCharacter } from '@/contexts/CharacterContext';
import { useAbilityRollingLogic } from '@/hooks/ability-score/use-ability-rolling-logic';
import { usePointBuyLogic, ABILITIES, POINT_COST } from '@/hooks/ability-score/use-point-buy-logic';
import { useToast } from '@/hooks/use-toast';
import { calculateModifier } from '@/utils/abilityScoreUtils';
import { type AbilityScoreRollResult } from '@/utils/diceRolls';
import {
  calculateRacialBonuses,
  getTotalRacialBonus,
  type AbilityScoreName,
  type RacialBonus,
} from '@/utils/racialAbilityBonuses';

export { ABILITIES, POINT_COST };

export type Method = 'pointBuy' | 'standardArray' | 'roll';

export interface UseAbilityScoreSelectionReturn {
  state: ReturnType<typeof useCharacter>['state'];
  method: Method;
  setMethod: React.Dispatch<React.SetStateAction<Method>>;
  rollHistory: number[][];
  currentRollDetails: AbilityScoreRollResult | null;
  remainingPoints: number;
  handleIncreaseScore: (ability: keyof AbilityScores) => void;
  handleDecreaseScore: (ability: keyof AbilityScores) => void;
  handleRollScores: () => void;
  handleRerollSingleScore: (abilityIndex: number) => void;
  handleStandardArray: () => void;
  handleReset: () => void;
  getAbilityDescription: (ability: keyof AbilityScores) => string;
  racialBonuses: RacialBonus[];
  getFinalScore: (ability: keyof AbilityScores) => number;
  pointsUsed: number;
  pointBuyValid: boolean;
  standardArrayValid: boolean;
  totalModifier: number;
}

/**
 * Hook for managing ability score selection logic
 * Extracted from AbilityScoresSelection.tsx
 * Refactored to delegate to specialized sub-hooks
 */
export const useAbilityScoreSelection = (): UseAbilityScoreSelectionReturn => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const [method, setMethod] = useState<Method>('pointBuy');

  // Delegate point-buy logic
  const {
    remainingPoints,
    setRemainingPoints,
    handleIncreaseScore,
    handleDecreaseScore,
    pointsUsed,
    pointBuyValid,
  } = usePointBuyLogic({
    character: state.character,
    dispatch,
    method,
  });

  // Delegate rolling logic
  const {
    rollHistory,
    setRollHistory,
    currentRollDetails,
    setCurrentRollDetails,
    handleRollScores,
    handleRerollSingleScore,
  } = useAbilityRollingLogic({
    character: state.character,
    dispatch,
  });

  /**
   * Applies the standard array to ability scores
   */
  const handleStandardArray = useCallback(() => {
    const standardArray = [15, 14, 13, 12, 10, 8];
    const newScores: AbilityScores = {
      strength: { score: 8, modifier: -1, savingThrow: false },
      dexterity: { score: 8, modifier: -1, savingThrow: false },
      constitution: { score: 8, modifier: -1, savingThrow: false },
      intelligence: { score: 8, modifier: -1, savingThrow: false },
      wisdom: { score: 8, modifier: -1, savingThrow: false },
      charisma: { score: 8, modifier: -1, savingThrow: false },
      ...state.character?.abilityScores,
    };

    ABILITIES.forEach((ability, index) => {
      newScores[ability] = {
        score: standardArray[index],
        modifier: calculateModifier(standardArray[index]),
        savingThrow: state.character?.abilityScores?.[ability]?.savingThrow || false,
      };
    });

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { abilityScores: newScores },
    });

    toast({
      title: 'Standard Array Applied!',
      description: 'Scores set to: 15, 14, 13, 12, 10, 8',
    });
  }, [state.character?.abilityScores, dispatch, toast]);

  /**
   * Resets all ability scores to 8
   */
  const handleReset = useCallback(() => {
    const newScores: AbilityScores = {
      strength: { score: 8, modifier: -1, savingThrow: false },
      dexterity: { score: 8, modifier: -1, savingThrow: false },
      constitution: { score: 8, modifier: -1, savingThrow: false },
      intelligence: { score: 8, modifier: -1, savingThrow: false },
      wisdom: { score: 8, modifier: -1, savingThrow: false },
      charisma: { score: 8, modifier: -1, savingThrow: false },
      ...state.character?.abilityScores,
    };

    ABILITIES.forEach((ability) => {
      newScores[ability] = {
        score: 8,
        modifier: calculateModifier(8),
        savingThrow: state.character?.abilityScores?.[ability]?.savingThrow || false,
      };
    });

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { abilityScores: newScores },
    });

    setRemainingPoints(27);
    setRollHistory([]);
    setCurrentRollDetails(null);
  }, [
    state.character?.abilityScores,
    dispatch,
    setRemainingPoints,
    setRollHistory,
    setCurrentRollDetails,
  ]);

  const getAbilityDescription = useCallback((ability: keyof AbilityScores) => {
    const descriptions: Record<keyof AbilityScores, string> = {
      strength: 'Physical power, athletic ability, melee attacks',
      dexterity: 'Agility, reflexes, ranged attacks, AC, initiative',
      constitution: 'Health, stamina, hit points, concentration',
      intelligence: 'Reasoning, memory, arcane magic, investigation',
      wisdom: 'Awareness, insight, divine magic, perception',
      charisma: 'Force of personality, leadership, social skills',
    };
    return descriptions[ability];
  }, []);

  // Calculate racial bonuses (useMemo to avoid recalculation)
  const racialBonuses = useMemo(
    () =>
      calculateRacialBonuses(
        state.character?.race || null,
        state.character?.subrace || null,
        state.character?.racialAbilityChoices,
      ),
    [state.character?.race, state.character?.subrace, state.character?.racialAbilityChoices],
  );

  // Calculate final scores with racial bonuses applied
  const getFinalScore = useCallback(
    (ability: keyof AbilityScores): number => {
      const baseScore = state.character?.abilityScores?.[ability]?.score || 8;
      const totalRacialBonus = getTotalRacialBonus(ability as AbilityScoreName, racialBonuses);
      // Cap at 20 per D&D 5E rules
      return Math.min(baseScore + totalRacialBonus, 20);
    },
    [state.character?.abilityScores, racialBonuses],
  );

  // Validate standard array: must use exactly [15,14,13,12,10,8]
  const standardArrayValid = useMemo(() => {
    if (method !== 'standardArray') return true;
    const usedScores = ABILITIES.map(
      (ability) => state.character?.abilityScores?.[ability]?.score || 8,
    ).sort((a, b) => b - a);
    const expectedArray = [15, 14, 13, 12, 10, 8];
    return JSON.stringify(usedScores) === JSON.stringify(expectedArray);
  }, [method, state.character?.abilityScores]);

  // Calculate total modifier bonus
  const totalModifier = useMemo(() => {
    return ABILITIES.reduce((total, ability) => {
      return total + (state.character?.abilityScores[ability].modifier || 0);
    }, 0);
  }, [state.character?.abilityScores]);

  return useMemo(() => ({
    state,
    method,
    setMethod,
    rollHistory,
    currentRollDetails,
    remainingPoints,
    handleIncreaseScore,
    handleDecreaseScore,
    handleRollScores,
    handleRerollSingleScore,
    handleStandardArray,
    handleReset,
    getAbilityDescription,
    racialBonuses,
    getFinalScore,
    pointsUsed,
    pointBuyValid,
    standardArrayValid,
    totalModifier,
  }), [
    state,
    method,
    rollHistory,
    currentRollDetails,
    remainingPoints,
    handleIncreaseScore,
    handleDecreaseScore,
    handleRollScores,
    handleRerollSingleScore,
    handleStandardArray,
    handleReset,
    getAbilityDescription,
    racialBonuses,
    getFinalScore,
    pointsUsed,
    pointBuyValid,
    standardArrayValid,
    totalModifier,
  ]);
};
