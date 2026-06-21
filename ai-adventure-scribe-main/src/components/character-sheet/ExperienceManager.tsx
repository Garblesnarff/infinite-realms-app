import React, { useId } from 'react';

import type { Character } from '@/types/character';

import { ExperienceActions } from '@/features/character/components/sheet/experience/ExperienceActions';
import { ExperienceHistory } from '@/features/character/components/sheet/experience/ExperienceHistory';
import { ExperienceOverview } from '@/features/character/components/sheet/experience/ExperienceOverview';
import { ExperienceQuickLevelSet } from '@/features/character/components/sheet/experience/ExperienceQuickLevelSet';
import { ExperienceTableReference } from '@/features/character/components/sheet/experience/ExperienceTableReference';
import { useExperienceManager } from '@/features/character/components/sheet/experience/useExperienceManager';

interface ExperienceManagerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * ExperienceManager component for tracking and managing character experience
 */
const ExperienceManager: React.FC<ExperienceManagerProps> = ({ character, onUpdate }) => {
  const historyId = useId();
  const historyTitleId = useId();

  const {
    currentExperience,
    currentLevel,
    calculatedLevel,
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
  } = useExperienceManager({ character, onUpdate });

  return (
    <div className="space-y-6">
      {/* Current Status */}
      <ExperienceOverview
        currentLevel={currentLevel}
        currentExperience={currentExperience}
        experienceNeeded={experienceNeeded}
        previousLevelXP={previousLevelXP}
        nextLevelXP={nextLevelXP}
        progressToNextLevel={progressToNextLevel}
        calculatedLevel={calculatedLevel}
      />

      {/* Experience Management */}
      <ExperienceActions
        experienceAmount={experienceAmount}
        setExperienceAmount={setExperienceAmount}
        experienceSource={experienceSource}
        setExperienceSource={setExperienceSource}
        awardExperience={awardExperience}
        removeExperience={removeExperience}
      />

      {/* Level Shortcuts */}
      <ExperienceQuickLevelSet
        currentLevel={currentLevel}
        setToLevel={setToLevel}
      />

      {/* Experience Table Reference */}
      <ExperienceTableReference
        currentLevel={currentLevel}
      />

      {/* Experience History */}
      <ExperienceHistory
        showHistory={showHistory}
        setShowHistory={setShowHistory}
        experienceHistory={experienceHistory}
        historyId={historyId}
        historyTitleId={historyTitleId}
      />
    </div>
  );
};

export default ExperienceManager;
