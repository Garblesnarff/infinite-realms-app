import { useState, useMemo, useCallback } from 'react';

import { abilityModifier } from '../../shared/ability-modifier';

import type { AbilityScores } from '@/types/character';

import { useCharacter } from '@/contexts/CharacterContext';
import { useAbilityRollingLogic } from '@/hooks/ability-score/use-ability-rolling-logic';
import {
  calculatePointBuyPoints,
  usePointBuyLogic,
  ABILITIES,
  POINT_BUY_MAX,
  POINT_BUY_MIN,
  POINT_BUY_TOTAL,
  POINT_COST,
} from '@/hooks/ability-score/use-point-buy-logic';
import { useToast } from '@/hooks/use-toast';
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
  setMethod: (method: Method) => void;
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
  pointBuyScoreRangeValid: boolean;
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
  const [method, setMethodState] = useState<Method>(
    () => state.character?.abilityScoreMethod ?? 'pointBuy',
  );

  // Delegate point-buy logic
  const {
    remainingPoints,
    setRemainingPoints,
    handleIncreaseScore,
    handleDecreaseScore,
    pointsUsed,
    pointBuyScoreRangeValid,
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
        modifier: abilityModifier(standardArray[index]),
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
        modifier: abilityModifier(8),
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

  const handleMethodChange = useCallback(
    (nextMethod: Method) => {
      setMethodState(nextMethod);
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { abilityScoreMethod: nextMethod },
      });
      if (nextMethod !== 'pointBuy') return;

      const scores = state.character?.abilityScores;
      const hasOutOfRangeScore = ABILITIES.some((ability) => {
        const score = scores?.[ability]?.score ?? POINT_BUY_MIN;
        return score < POINT_BUY_MIN || score > POINT_BUY_MAX;
      });

      if (hasOutOfRangeScore) {
        handleReset();
        return;
      }

      setRemainingPoints(POINT_BUY_TOTAL - calculatePointBuyPoints(state.character));
    },
    [dispatch, handleReset, setRemainingPoints, state.character],
  );

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
      return total + calculateModifier(getFinalScore(ability));
    }, 0);
  }, [getFinalScore]);

  return useMemo(
    () => ({
      state,
      method,
      setMethod: handleMethodChange,
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
      pointBuyScoreRangeValid,
      pointBuyValid,
      standardArrayValid,
      totalModifier,
    }),
    [
      state,
      method,
      handleMethodChange,
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
      pointBuyScoreRangeValid,
      pointBuyValid,
      standardArrayValid,
      totalModifier,
    ],
  );
};
