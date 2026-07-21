import { Target } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ExperienceQuickLevelSetProps {
  currentLevel: number;
  setToLevel: (level: number) => void;
}

export const ExperienceQuickLevelSet: React.FC<ExperienceQuickLevelSetProps> = ({
  currentLevel,
  setToLevel,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="w-5 h-5 text-infinite-purple" aria-hidden="true" />
          Quick Level Set
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((level) => (
            <Tooltip key={level}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={level === currentLevel ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setToLevel(level)}
                  disabled={level === currentLevel}
                  aria-label={`Set experience to level ${level}`}
                >
                  {level}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Set experience to level {level}</p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Click a level to set your experience to that level's minimum requirement.
        </p>
      </CardContent>
    </Card>
  );
};
