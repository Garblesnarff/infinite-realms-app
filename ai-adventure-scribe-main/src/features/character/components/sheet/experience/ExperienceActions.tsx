import { TrendingUp, Plus, Minus } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface ExperienceActionsProps {
  experienceAmount: number;
  setExperienceAmount: (amount: number) => void;
  experienceSource: string;
  setExperienceSource: (source: string) => void;
  awardExperience: () => void;
  removeExperience: () => void;
}

export const ExperienceActions: React.FC<ExperienceActionsProps> = ({
  experienceAmount,
  setExperienceAmount,
  experienceSource,
  setExperienceSource,
  awardExperience,
  removeExperience,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-500" aria-hidden="true" />
          Manage Experience
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="experience-amount">Experience Amount</Label>
              <Input
                id="experience-amount"
                type="number"
                min="0"
                value={experienceAmount || ''}
                onChange={(e) => setExperienceAmount(Number(e.target.value))}
                placeholder="Enter XP amount"
              />
            </div>
            <div>
              <Label htmlFor="experience-source">Source/Reason</Label>
              <Input
                id="experience-source"
                type="text"
                value={experienceSource}
                onChange={(e) => setExperienceSource(e.target.value)}
                placeholder="e.g., Defeated dragon, Completed quest"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              onClick={awardExperience}
              disabled={!experienceAmount || !experienceSource}
              className="flex-1"
            >
              <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              Award XP
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={removeExperience}
              disabled={!experienceAmount || !experienceSource}
              className="flex-1"
            >
              <Minus className="w-4 h-4 mr-2" aria-hidden="true" />
              Remove XP
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
