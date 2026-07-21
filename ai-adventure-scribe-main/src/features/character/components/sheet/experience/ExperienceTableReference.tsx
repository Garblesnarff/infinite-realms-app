import { Calendar } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { experienceTable } from '@/data/levelProgression';

interface ExperienceTableReferenceProps {
  currentLevel: number;
}

export const ExperienceTableReference: React.FC<ExperienceTableReferenceProps> = ({
  currentLevel,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          Experience Table
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {Object.entries(experienceTable).map(([level, xp]) => (
            <div
              key={level}
              className={`p-2 border rounded text-center ${
                Number(level) === currentLevel ? 'bg-primary/10 border-primary' : ''
              }`}
            >
              <div className="font-medium">Level {level}</div>
              <div className="text-muted-foreground">{xp.toLocaleString()} XP</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};
