import { Trophy, Star } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface ExperienceOverviewProps {
  currentLevel: number;
  currentExperience: number;
  experienceNeeded: number;
  previousLevelXP: number;
  nextLevelXP: number;
  progressToNextLevel: number;
  calculatedLevel: number;
  levelUpNode?: React.ReactNode;
}

export const ExperienceOverview: React.FC<ExperienceOverviewProps> = ({
  currentLevel,
  currentExperience,
  experienceNeeded,
  previousLevelXP,
  nextLevelXP,
  progressToNextLevel,
  calculatedLevel,
  levelUpNode,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-gold-500" aria-hidden="true" />
          Experience Overview
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="text-center p-4 border rounded-lg">
            <div className="text-3xl font-bold text-primary">{currentLevel}</div>
            <div className="text-sm text-muted-foreground">Current Level</div>
          </div>
          <div className="text-center p-4 border rounded-lg">
            <div className="text-3xl font-bold">{currentExperience.toLocaleString()}</div>
            <div className="text-sm text-muted-foreground">Total Experience</div>
          </div>
          <div className="text-center p-4 border rounded-lg">
            <div className="text-3xl font-bold text-green-600">
              {currentLevel >= 20 ? '0' : experienceNeeded.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground">
              {currentLevel >= 20 ? 'Max Level' : 'XP to Next Level'}
            </div>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Level {currentLevel}</span>
            <span>{currentLevel >= 20 ? 'Max Level Reached' : `Level ${Math.min(20, currentLevel + 1)}`}</span>
          </div>
          <Progress
            value={progressToNextLevel}
            className="h-3"
            aria-label={`${Math.round(progressToNextLevel)}% toward level ${Math.min(20, currentLevel + 1)}`}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{previousLevelXP.toLocaleString()} XP</span>
            <span>
              {currentLevel >= 20
                ? currentExperience.toLocaleString()
                : nextLevelXP.toLocaleString()}{' '}
              XP
            </span>
          </div>
        </div>

        {/* Level Check Warning */}
        {calculatedLevel > currentLevel && (
          <div
            role="status"
            aria-live="polite"
            className="mt-4"
          >
            {levelUpNode ? (
              levelUpNode
            ) : (
              <div className="p-3 bg-primary/10 border border-primary rounded-lg">
                <div className="flex items-center gap-2 text-primary font-medium">
                  <Star className="w-4 h-4" aria-hidden="true" />
                  Level Up Available!
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  You have enough experience for level {calculatedLevel}. Visit the Character
                  Advancement section to level up.
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
