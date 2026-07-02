import { Heart } from 'lucide-react';
import React from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface HitPointsBreakdownCardProps {
  className: string;
  hitDie: number;
  level: number;
  conModifier: number;
  method: 'roll' | 'average';
  averagePerLevel: number;
  hasRolls: boolean;
  rollResults: number[];
  maxHPPreview: number;
}

export const HitPointsBreakdownCard: React.FC<HitPointsBreakdownCardProps> = ({
  className,
  hitDie,
  level,
  conModifier,
  method,
  averagePerLevel,
  hasRolls,
  rollResults,
  maxHPPreview,
}) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center gap-2">
        <Heart className="w-5 h-5 text-red-500" />
        Hit Point Breakdown
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span>Class:</span>
          <span>
            {className} (d{hitDie})
          </span>
        </div>
        <div className="flex justify-between">
          <span>Level:</span>
          <span>{level}</span>
        </div>
        <div className="flex justify-between">
          <span>Constitution Modifier:</span>
          <span>
            {conModifier >= 0 ? '+' : ''}
            {conModifier}
          </span>
        </div>
        <div className="flex justify-between">
          <span>1st Level HP:</span>
          <span>
            {hitDie} + {conModifier} = {hitDie + conModifier}
          </span>
        </div>
        {level > 1 && (
          <div className="flex justify-between">
            <span>Additional Levels:</span>
            <span>
              {method === 'average'
                ? `${level - 1} × (${averagePerLevel} + ${conModifier}) = ${(level - 1) * (averagePerLevel + conModifier)}`
                : hasRolls
                  ? `${rollResults
                      .slice(0, level - 1)
                      .map((r) => `${r} + ${conModifier}`)
                      .join(
                        ' + ',
                      )} = ${rollResults.slice(0, level - 1).reduce((sum, roll) => sum + roll + conModifier, 0)}`
                  : 'Not rolled yet'}
            </span>
          </div>
        )}
        <hr />
        <div className="flex justify-between font-semibold">
          <span>Maximum Hit Points:</span>
          <span className="text-red-600">{maxHPPreview}</span>
        </div>
      </div>
    </CardContent>
  </Card>
);
