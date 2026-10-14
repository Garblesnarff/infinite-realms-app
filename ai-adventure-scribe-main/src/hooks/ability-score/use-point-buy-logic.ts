import { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import { abilityModifier } from '../../../shared/ability-modifier';

import type { AbilityScores, Character } from '@/types/character';

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

export const POINT_BUY_TOTAL = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

export const ABILITIES: (keyof AbilityScores)[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

export const calculatePointBuyPoints = (character: Character | null): number =>
  ABILITIES.reduce((total, ability) => {
    const score = character?.abilityScores?.[ability]?.score ?? POINT_BUY_MIN;
    return total + (POINT_COST[score] ?? 0);
  }, 0);

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
    return (
      character?.remainingAbilityPoints ??
      (method === 'pointBuy'
        ? POINT_BUY_TOTAL - calculatePointBuyPoints(character)
        : POINT_BUY_TOTAL)
    );
  });
  const abilityScoreSignature = ABILITIES.map(
    (ability) => character?.abilityScores?.[ability]?.score ?? POINT_BUY_MIN,
  ).join('|');
  const previousAbilityScoreSignature = useRef(abilityScoreSignature);

  useEffect(() => {
    if (method === 'pointBuy' && abilityScoreSignature !== previousAbilityScoreSignature.current) {
      setRemainingPoints(POINT_BUY_TOTAL - calculatePointBuyPoints(character));
    }
    previousAbilityScoreSignature.current = abilityScoreSignature;
  }, [abilityScoreSignature, character, method]);

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
      const currentScore = character?.abilityScores?.[ability]?.score ?? POINT_BUY_MIN;
      if (
        method === 'pointBuy' &&
        currentScore >= POINT_BUY_MIN &&
        currentScore < POINT_BUY_MAX &&
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
            modifier: abilityModifier(currentScore + 1),
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
    [character?.abilityScores, method, remainingPoints, dispatch],
  );

  /**
   * Handles decreasing an ability score and refunding points
   */
  const handleDecreaseScore = useCallback(
    (ability: keyof AbilityScores) => {
      const currentScore = character?.abilityScores?.[ability]?.score ?? POINT_BUY_MIN;
      if (method === 'pointBuy' && currentScore > POINT_BUY_MIN && currentScore <= POINT_BUY_MAX) {
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
            modifier: abilityModifier(currentScore - 1),
            savingThrow: character?.abilityScores?.[ability]?.savingThrow || false,
          },
        };

        dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { abilityScores: newScores },
        });

        setRemainingPoints((prev) =>
          Math.min(
            POINT_BUY_TOTAL,
            prev + (POINT_COST[currentScore] - POINT_COST[currentScore - 1]),
          ),
        );
      }
    },
    [character?.abilityScores, method, dispatch],
  );

  // Validate point buy: 27 points total
  const pointsUsed = useMemo(() => {
    if (method !== 'pointBuy') return 0;
    return calculatePointBuyPoints(character);
  }, [method, character]);

  const pointBuyScoreRangeValid =
    method !== 'pointBuy' ||
    ABILITIES.every((ability) => {
      const score = character?.abilityScores?.[ability]?.score ?? POINT_BUY_MIN;
      return score >= POINT_BUY_MIN && score <= POINT_BUY_MAX;
    });
  const pointBuyValid =
    method !== 'pointBuy' || (pointBuyScoreRangeValid && pointsUsed <= POINT_BUY_TOTAL);

  // ⚡ Bolt: Wrap the returned object in useMemo to enforce referential stability,
  // preventing unnecessary component downstream re-renders or execution of effects.
  return useMemo(
    () => ({
      remainingPoints,
      setRemainingPoints,
      handleIncreaseScore,
      handleDecreaseScore,
      pointsUsed,
      pointBuyScoreRangeValid,
      pointBuyValid,
    }),
    [
      remainingPoints,
      handleIncreaseScore,
      handleDecreaseScore,
      pointsUsed,
      pointBuyScoreRangeValid,
      pointBuyValid,
    ],
  );
};
