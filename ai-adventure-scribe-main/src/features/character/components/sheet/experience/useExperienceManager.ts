import { useState } from 'react';

import type { Character } from '@/types/character';

import { getLevelFromExperience, getExperienceForLevel } from '@/data/levelProgression';
import { useToast } from '@/hooks/use-toast';

interface UseExperienceManagerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

export interface ExperienceEntry {
  id: string;
  amount: number;
  source: string;
  date: string;
  type: 'gain' | 'loss';
}

export const useExperienceManager = ({ character, onUpdate }: UseExperienceManagerProps) => {
  const { toast } = useToast();
  const [experienceAmount, setExperienceAmount] = useState<number>(0);
  const [experienceSource, setExperienceSource] = useState<string>('');
  const [showHistory, setShowHistory] = useState(false);

  const currentExperience = character?.experience || 0;
  const currentLevel = character?.level || 1;
  const calculatedLevel = getLevelFromExperience(currentExperience);

  const nextLevel = Math.min(20, currentLevel + 1);
  const nextLevelXP = getExperienceForLevel(nextLevel);
  const previousLevelXP = getExperienceForLevel(currentLevel);

  const progressToNextLevel =
    currentLevel >= 20
      ? 100
      : ((currentExperience - previousLevelXP) / (nextLevelXP - previousLevelXP)) * 100;

  const experienceNeeded = Math.max(0, nextLevelXP - currentExperience);

  // Mock experience history - in full implementation, this would be stored
  const experienceHistory: ExperienceEntry[] = [
    {
      id: '1',
      amount: 300,
      source: 'Defeated goblin patrol',
      date: '2024-01-15',
      type: 'gain',
    },
    {
      id: '2',
      amount: 150,
      source: 'Solved riddle puzzle',
      date: '2024-01-16',
      type: 'gain',
    },
    {
      id: '3',
      amount: 450,
      source: 'Completed quest: Save the Village',
      date: '2024-01-18',
      type: 'gain',
    },
  ];

  const awardExperience = () => {
    if (experienceAmount <= 0 || !experienceSource.trim()) {
      toast({
        title: 'Invalid Input',
        description: 'Please enter a valid experience amount and source.',
        variant: 'destructive',
      });
      return;
    }

    const newExperience = currentExperience + experienceAmount;
    const newLevel = getLevelFromExperience(newExperience);

    onUpdate({
      ...character,
      experience: newExperience,
    });

    if (newLevel > currentLevel) {
      toast({
        title: 'Level Up Available!',
        description: `You have enough experience for level ${newLevel}. Visit the advancement section to level up.`,
      });
    } else {
      toast({
        title: 'Experience Awarded',
        description: `Gained ${experienceAmount} XP from: ${experienceSource}`,
      });
    }

    setExperienceAmount(0);
    setExperienceSource('');
  };

  const removeExperience = () => {
    if (experienceAmount <= 0 || !experienceSource.trim()) {
      toast({
        title: 'Invalid Input',
        description: 'Please enter a valid experience amount and source.',
        variant: 'destructive',
      });
      return;
    }

    const newExperience = Math.max(0, currentExperience - experienceAmount);

    onUpdate({
      ...character,
      experience: newExperience,
    });

    toast({
      title: 'Experience Removed',
      description: `Removed ${experienceAmount} XP: ${experienceSource}`,
    });

    setExperienceAmount(0);
    setExperienceSource('');
  };

  const setToLevel = (targetLevel: number) => {
    const requiredXP = getExperienceForLevel(targetLevel);

    onUpdate({
      ...character,
      experience: requiredXP,
    });

    toast({
      title: 'Experience Set',
      description: `Set experience to ${requiredXP.toLocaleString()} XP (Level ${targetLevel}).`,
    });
  };

  return {
    currentExperience,
    currentLevel,
    calculatedLevel,
    nextLevel,
    nextLevelXP,
    previousLevelXP,
    progressToNextLevel,
    experienceNeeded,
    experienceAmount,
    setExperienceAmount,
    experienceSource,
    setExperienceSource,
    showHistory,
    setShowHistory,
    experienceHistory,
    awardExperience,
    removeExperience,
    setToLevel,
  };
};
