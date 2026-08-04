import { useState, useEffect, useMemo, useCallback } from 'react';

import type { AbilityScores, Character } from '@/types/character';

import { calculateModifier } from '@/utils/abilityScoreUtils';

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

interface UsePointBuyLogicProps {
  character: Character | null;
  dispatch: (action: any) => void;
  method: string;
}

/**
 * Hook for managing point-buy ability score selection logic
 */
export const usePointBuyLogic = ({ character, dispatch, method }: UsePointBuyLogicProps) => {
  // Initialize remaining points from context or default value
  const [remainingPoints, setRemainingPoints] = useState(() => {
    return character?.remainingAbilityPoints ?? 27;
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
      const currentScore = character?.abilityScores?.[ability]?.score || 8;
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
          ...character?.abilityScores,
          [ability]: {
            score: currentScore + 1,
            modifier: calculateModifier(currentScore + 1),
            savingThrow: character?.abilityScores?.[ability]?.savingThrow || false,
          },
        };

        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { abilityScores: newScores },
        });

        setRemainingPoints(
          (prev) => prev - (POINT_COST[currentScore + 1] - POINT_COST[currentScore]),
        );
      }
    },
    [character?.abilityScores, remainingPoints, dispatch],
  );

  /**
   * Handles decreasing an ability score and refunding points
   */
  const handleDecreaseScore = useCallback(
    (ability: keyof AbilityScores) => {
      const currentScore = character?.abilityScores?.[ability]?.score || 8;
      if (currentScore > 8) {
        const newScores: AbilityScores = {
          strength: { score: 8, modifier: -1, savingThrow: false },
          dexterity: { score: 8, modifier: -1, savingThrow: false },
          constitution: { score: 8, modifier: -1, savingThrow: false },
          intelligence: { score: 8, modifier: -1, savingThrow: false },
          wisdom: { score: 8, modifier: -1, savingThrow: false },
          charisma: { score: 8, modifier: -1, savingThrow: false },
          ...character?.abilityScores,
          [ability]: {
            score: currentScore - 1,
            modifier: calculateModifier(currentScore - 1),
            savingThrow: character?.abilityScores?.[ability]?.savingThrow || false,
          },
        };

        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { abilityScores: newScores },
        });

        setRemainingPoints(
          (prev) => prev + (POINT_COST[currentScore] - POINT_COST[currentScore - 1]),
        );
      }
    },
    [character?.abilityScores, dispatch],
  );

  // Validate point buy: 27 points total
  const pointsUsed = useMemo(() => {
    if (method !== 'pointBuy') return 0;
    return ABILITIES.reduce((total, ability) => {
      const score = character?.abilityScores?.[ability]?.score || 8;
      return total + (POINT_COST[score] || 0);
    }, 0);
  }, [method, character?.abilityScores]);

  const pointBuyValid = method !== 'pointBuy' || pointsUsed <= 27;

  // ⚡ Bolt: Wrap the returned object in useMemo to enforce referential stability,
  // preventing unnecessary component downstream re-renders or execution of effects.
  return useMemo(
    () => ({
      remainingPoints,
      setRemainingPoints,
      handleIncreaseScore,
      handleDecreaseScore,
      pointsUsed,
      pointBuyValid,
    }),
    [
      remainingPoints,
      handleIncreaseScore,
      handleDecreaseScore,
      pointsUsed,
      pointBuyValid,
    ],
  );
};
