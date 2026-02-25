import { useState, useEffect, useMemo, useCallback } from 'react';

import type { AbilityScores } from '@/types/character';

import { useToast } from '@/components/ui/use-toast';
import { useCharacter } from '@/contexts/CharacterContext';
import { calculateModifier } from '@/utils/abilityScoreUtils';
import {
  generateAbilityScoresDetailed,
  rerollSingleScoreDetailed,
  type AbilityScoreRollResult,
} from '@/utils/diceRolls';
import {
  calculateRacialBonuses,
  getTotalRacialBonus,
  type AbilityScoreName,
  type RacialBonus,
} from '@/utils/racialAbilityBonuses';

export type Method = 'pointBuy' | 'standardArray' | 'roll';

// Cost table for point-buy system
export const POINT_COST: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

export const ABILITIES: (keyof AbilityScores)[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

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
 */
export const useAbilityScoreSelection = (): UseAbilityScoreSelectionReturn => {
  const { state, dispatch } = useCharacter();
  const { toast } = useToast();
  const [method, setMethod] = useState<Method>('pointBuy');
  const [rollHistory, setRollHistory] = useState<number[][]>([]);
  const [currentRollDetails, setCurrentRollDetails] = useState<AbilityScoreRollResult | null>(null);

  // Initialize remaining points from context or default value
  const [remainingPoints, setRemainingPoints] = useState(() => {
    return state.character?.remainingAbilityPoints ?? 27;
  });

  useEffect(() => {
    // Update context with remaining points whenever they change
    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { remainingAbilityPoints: remainingPoints },
    });
  }, [remainingPoints, dispatch]);

  /**
   * Handles increasing an ability score if points are available
   */
  const handleIncreaseScore = useCallback(
    (ability: keyof AbilityScores) => {
      const currentScore = state.character?.abilityScores?.[ability]?.score || 8;
      if (
        currentScore < 15 &&
        remainingPoints >= POINT_COST[currentScore + 1] - POINT_COST[currentScore]
      ) {
        const newScores: AbilityScores = {
          strength: { score: 8, modifier: -1, savingThrow: false },
          dexterity: { score: 8, modifier: -1, savingThrow: false },
          constitution: { score: 8, modifier: -1, savingThrow: false },
          intelligence: { score: 8, modifier: -1, savingThrow: false },
          wisdom: { score: 8, modifier: -1, savingThrow: false },
          charisma: { score: 8, modifier: -1, savingThrow: false },
          ...state.character?.abilityScores,
          [ability]: {
            score: currentScore + 1,
            modifier: calculateModifier(currentScore + 1),
            savingThrow: state.character?.abilityScores?.[ability]?.savingThrow || false,
          },
        };

        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { abilityScores: newScores },
        });

        setRemainingPoints((prev) => prev - (POINT_COST[currentScore + 1] - POINT_COST[currentScore]));
      }
    },
    [state.character?.abilityScores, remainingPoints, dispatch],
  );

  /**
   * Handles decreasing an ability score and refunding points
   */
  const handleDecreaseScore = useCallback(
    (ability: keyof AbilityScores) => {
      const currentScore = state.character?.abilityScores?.[ability]?.score || 8;
      if (currentScore > 8) {
        const newScores: AbilityScores = {
          strength: { score: 8, modifier: -1, savingThrow: false },
          dexterity: { score: 8, modifier: -1, savingThrow: false },
          constitution: { score: 8, modifier: -1, savingThrow: false },
          intelligence: { score: 8, modifier: -1, savingThrow: false },
          wisdom: { score: 8, modifier: -1, savingThrow: false },
          charisma: { score: 8, modifier: -1, savingThrow: false },
          ...state.character?.abilityScores,
          [ability]: {
            score: currentScore - 1,
            modifier: calculateModifier(currentScore - 1),
            savingThrow: state.character?.abilityScores?.[ability]?.savingThrow || false,
          },
        };

        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { abilityScores: newScores },
        });

        setRemainingPoints((prev) => prev + (POINT_COST[currentScore] - POINT_COST[currentScore - 1]));
      }
    },
    [state.character?.abilityScores, dispatch],
  );

  /**
   * Handles rolling new ability scores with detailed results
   */
  const handleRollScores = useCallback(() => {
    const rollResult = generateAbilityScoresDetailed();
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
        score: rollResult.scores[index],
        modifier: calculateModifier(rollResult.scores[index]),
        savingThrow: state.character?.abilityScores?.[ability]?.savingThrow || false,
      };
    });

    setRollHistory((prev) => [...prev, rollResult.scores]);
    setCurrentRollDetails(rollResult);

    dispatch({
      type: 'UPDATE_CHARACTER',
      payload: { abilityScores: newScores },
    });

    toast({
      title: 'Ability Scores Rolled!',
      description: 'New scores have been generated using 4d6 drop lowest.',
    });
  }, [state.character?.abilityScores, dispatch, toast]);

  /**
   * Handles rerolling a single ability score
   */
  const handleRerollSingleScore = useCallback(
    (abilityIndex: number) => {
      if (!currentRollDetails) return;

      const currentScores = ABILITIES.map(
        (ability) => state.character?.abilityScores?.[ability]?.score || 8,
      );
      const updatedResult = rerollSingleScoreDetailed(
        currentScores,
        currentRollDetails.details,
        abilityIndex,
      );

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
          score: updatedResult.scores[index],
          modifier: calculateModifier(updatedResult.scores[index]),
          savingThrow: state.character?.abilityScores?.[ability]?.savingThrow || false,
        };
      });

      setCurrentRollDetails(updatedResult);

      // Update roll history with the new scores
      const newHistory = [...rollHistory];
      if (newHistory.length > 0) {
        newHistory[newHistory.length - 1] = updatedResult.scores;
        setRollHistory(newHistory);
      }

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { abilityScores: newScores },
      });

      toast({
        title: 'Score Rerolled!',
        description: `${ABILITIES[abilityIndex]} has been rerolled.`,
      });
    },
    [currentRollDetails, state.character?.abilityScores, rollHistory, dispatch, toast],
  );

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
  }, [state.character?.abilityScores, dispatch]);

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

  // Validate point buy: 27 points total
  const pointsUsed = useMemo(() => {
    if (method !== 'pointBuy') return 0;
    return ABILITIES.reduce((total, ability) => {
      const score = state.character?.abilityScores?.[ability]?.score || 8;
      return total + (POINT_COST[score] || 0);
    }, 0);
  }, [method, state.character?.abilityScores]);

  const pointBuyValid = method !== 'pointBuy' || pointsUsed <= 27;

  // Validate standard array: must use exactly [15,14,13,12,10,8]
  const standardArrayValid = useMemo(() => {
    if (method !== 'standardArray') return true;
    const usedScores = ABILITIES.map((ability) => state.character?.abilityScores?.[ability]?.score || 8).sort(
      (a, b) => b - a,
    );
    const expectedArray = [15, 14, 13, 12, 10, 8];
    return JSON.stringify(usedScores) === JSON.stringify(expectedArray);
  }, [method, state.character?.abilityScores]);

  // Calculate total modifier bonus
  const totalModifier = useMemo(() => {
    return ABILITIES.reduce((total, ability) => {
      return total + (state.character?.abilityScores[ability].modifier || 0);
    }, 0);
  }, [state.character?.abilityScores]);

  return {
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
  };
};
