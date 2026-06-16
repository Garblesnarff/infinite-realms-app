import { ChevronDown, ChevronRight } from 'lucide-react';
import React from 'react';

import type { ClassLevel } from './types';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  getAllClassFeaturesUpToLevel,
  getMulticlassProficiencies,
} from '@/data/levelProgression';


interface ClassDetailCardProps {
  cls: ClassLevel;
  isExpanded: boolean;
  onToggle: () => void;
}

/**
 * ClassDetailCard component displays details for a specific class level,
 * including features and proficiencies gained.
 */
export const ClassDetailCard: React.FC<ClassDetailCardProps> = ({
  cls,
  isExpanded,
  onToggle,
}) => {
  const classFeatures = getAllClassFeaturesUpToLevel(cls.className, cls.level);
  const multiclassProfs = getMulticlassProficiencies(cls.className);

  return (
    <Card>
      <CardHeader
        className="cursor-pointer hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-infinite-purple"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${cls.className} details`}
      >
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isExpanded ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronRight className="w-5 h-5" />
            )}
            {cls.className} (Level {cls.level})
          </div>
          <Badge variant="secondary">d{cls.hitDie}</Badge>
        </CardTitle>
      </CardHeader>
      {isExpanded && (
        <CardContent>
          <div className="space-y-4">
            {/* Multiclass Proficiencies Gained */}
            {Object.keys(multiclassProfs).length > 0 && (
              <div>
                <h4 className="font-medium mb-2">
                  Proficiencies Gained from Multiclassing
                </h4>
                <div className="space-y-2 text-sm">
                  {multiclassProfs.armor && (
                    <div>
                      <span className="font-medium">Armor:</span>{' '}
                      {multiclassProfs.armor.join(', ')}
                    </div>
                  )}
                  {multiclassProfs.weapons && (
                    <div>
                      <span className="font-medium">Weapons:</span>{' '}
                      {multiclassProfs.weapons.join(', ')}
                    </div>
                  )}
                  {multiclassProfs.tools && (
                    <div>
                      <span className="font-medium">Tools:</span>{' '}
                      {multiclassProfs.tools.join(', ')}
                    </div>
                  )}
                  {multiclassProfs.skillChoices && (
                    <div>
                      <span className="font-medium">Skills:</span> Choose{' '}
                      {multiclassProfs.numSkillChoices} from{' '}
                      {multiclassProfs.skillChoices.join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )}

            <Separator />

            {/* Class Features */}
            <div>
              <h4 className="font-medium mb-3">Class Features</h4>
              <div className="space-y-2">
                {classFeatures.map((feature, index) => (
                  <div key={index} className="flex items-start gap-3 p-2 border rounded">
                    <Badge variant="outline" className="text-xs mt-1">
                      {cls.level >= feature.level ? '✓' : '○'} L{feature.level}
                    </Badge>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{feature.featureName}</div>
                      <div className="text-xs text-muted-foreground">
                        {feature.description}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
