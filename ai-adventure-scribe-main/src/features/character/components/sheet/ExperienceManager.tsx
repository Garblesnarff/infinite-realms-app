import { Star } from 'lucide-react';
import React, { useId } from 'react';

import { ExperienceActions } from './experience/ExperienceActions';
import { ExperienceHistory } from './experience/ExperienceHistory';
import { ExperienceOverview } from './experience/ExperienceOverview';
import { ExperienceQuickLevelSet } from './experience/ExperienceQuickLevelSet';
import { ExperienceTableReference } from './experience/ExperienceTableReference';
import { useExperienceManager } from './experience/useExperienceManager';

import type { Character } from '@/types/character';

import { HexagonalBadge } from '@/components/ui/hexagonal-badge';

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
        levelUpNode={
          calculatedLevel > currentLevel ? (
            <div
              role="status"
              aria-live="polite"
              className="mt-4 rounded-lg border border-electricCyan/40 bg-electricCyan/10 p-3 shadow-glow-teal hover:shadow-glow-teal-lg transition-shadow"
            >
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 text-electricCyan" aria-hidden="true" />
                <HexagonalBadge
                  variant="status"
                  size="sm"
                  pulse={true}
                  className="text-xs bg-electricCyan/20 text-electricCyan border-electricCyan/40 shadow-glow-teal-sm font-semibold"
                >
                  Level Up Available!
                </HexagonalBadge>
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                You have enough experience for level {calculatedLevel}. Visit the Character
                Advancement section to level up.
              </div>
            </div>
          ) : null
        }
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
      <ExperienceQuickLevelSet currentLevel={currentLevel} setToLevel={setToLevel} />

      {/* Experience Table Reference */}
      <ExperienceTableReference currentLevel={currentLevel} />

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
