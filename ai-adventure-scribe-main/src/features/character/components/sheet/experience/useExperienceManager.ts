import { useState } from 'react';

import type { Character, CharacterSheetUpdateFn } from '@/types/character';

import { getLevelFromExperience, getExperienceForLevel } from '@/data/levelProgression';
import { useToast } from '@/hooks/use-toast';

interface UseExperienceManagerProps {
  character: Character;
  onUpdate: CharacterSheetUpdateFn;
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

  // #2701: the write happens inside onUpdate; the success toast fires only
  // after it lands. On failure the inputs stay so the user can retry, and the
  // persistence layer shows the single error toast.
  const awardExperience = async () => {
    if (experienceAmount < 0) {
      toast({
        title: 'Invalid XP Amount',
        description: 'The XP amount cannot be negative.',
        variant: 'destructive',
      });
      return;
    }
    if (!experienceSource.trim()) {
      toast({
        title: 'Missing Source',
        description: 'Please enter a source for the XP award.',
        variant: 'destructive',
      });
      return;
    }

    const newExperience = currentExperience + experienceAmount;
    // #2701: awards never reduce the level — a character stored above its
    // XP-derived level (manual set, migration) keeps it.
    const newLevel = Math.max(currentLevel, getLevelFromExperience(newExperience));

    // #2701: persist the level together with XP — the toast announces the
    // level-up, so the DB must reflect it.
    const saved = await onUpdate({
      ...character,
      experience: newExperience,
      level: newLevel,
    });
    if (!saved) {
      // The persistence layer already toasted the failure.
      return;
    }

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

  const removeExperience = async () => {
    if (experienceAmount < 0) {
      toast({
        title: 'Invalid XP Amount',
        description: 'The XP amount cannot be negative.',
        variant: 'destructive',
      });
      return;
    }
    if (!experienceSource.trim()) {
      toast({
        title: 'Missing Source',
        description: 'Please enter a source for the XP removal.',
        variant: 'destructive',
      });
      return;
    }

    const newExperience = Math.max(0, currentExperience - experienceAmount);
    // #2701: XP removal never demotes — 5e has no level loss on XP drain.
    // Level changes only via explicit setToLevel.
    const newLevel = Math.max(currentLevel, getLevelFromExperience(newExperience));

    // #2701: keep level in sync when XP drops across a threshold too.
    const saved = await onUpdate({
      ...character,
      experience: newExperience,
      level: newLevel,
    });
    if (!saved) {
      // The persistence layer already toasted the failure.
      return;
    }

    toast({
      title: 'Experience Removed',
      description: `Removed ${experienceAmount} XP: ${experienceSource}`,
    });

    setExperienceAmount(0);
    setExperienceSource('');
  };

  const setToLevel = async (targetLevel: number) => {
    const requiredXP = getExperienceForLevel(targetLevel);

    // #2701: the level is part of the update, not just implied by the XP.
    const saved = await onUpdate({
      ...character,
      experience: requiredXP,
      level: targetLevel,
    });
    if (!saved) {
      // The persistence layer already toasted the failure.
      return;
    }

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
