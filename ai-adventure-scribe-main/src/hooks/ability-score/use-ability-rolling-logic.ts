import { useState, useCallback } from 'react';

import type { AbilityScores, Character } from '@/types/character';

import { useToast } from '@/components/ui/use-toast';
import { calculateModifier } from '@/utils/abilityScoreUtils';
import {
  generateAbilityScoresDetailed,
  rerollSingleScoreDetailed,
  type AbilityScoreRollResult,
} from '@/utils/diceRolls';

const ABILITIES: (keyof AbilityScores)[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

interface UseAbilityRollingLogicProps {
  character: Character | null;
  dispatch: (action: any) => void;
}

/**
 * Hook for managing ability score rolling logic
 */
export const useAbilityRollingLogic = ({ character, dispatch }: UseAbilityRollingLogicProps) => {
  const { toast } = useToast();
  const [rollHistory, setRollHistory] = useState<number[][]>([]);
  const [currentRollDetails, setCurrentRollDetails] = useState<AbilityScoreRollResult | null>(null);

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
      ...character?.abilityScores,
    };

    ABILITIES.forEach((ability, index) => {
      newScores[ability] = {
        score: rollResult.scores[index],
        modifier: calculateModifier(rollResult.scores[index]),
        savingThrow: character?.abilityScores?.[ability]?.savingThrow || false,
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
  }, [character?.abilityScores, dispatch, toast]);

  /**
   * Handles rerolling a single ability score
   */
  const handleRerollSingleScore = useCallback(
    (abilityIndex: number) => {
      if (!currentRollDetails) return;

      const currentScores = ABILITIES.map(
        (ability) => character?.abilityScores?.[ability]?.score || 8,
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
        ...character?.abilityScores,
      };

      ABILITIES.forEach((ability, index) => {
        newScores[ability] = {
          score: updatedResult.scores[index],
          modifier: calculateModifier(updatedResult.scores[index]),
          savingThrow: character?.abilityScores?.[ability]?.savingThrow || false,
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
    [currentRollDetails, character?.abilityScores, rollHistory, dispatch, toast],
  );

  return {
    rollHistory,
    setRollHistory,
    currentRollDetails,
    setCurrentRollDetails,
    handleRollScores,
    handleRerollSingleScore,
  };
};
