import { Star, Zap } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

interface FeatureSectionProps {
  character: Character;
  classFeatures: ClassFeature[];
  onUseResource: (resourceName: string) => void;
}

/**
 * FeatureSection displays character class features with usage tracking
 */
export const FeatureSection: React.FC<FeatureSectionProps> = ({
  character,
  classFeatures,
  onUseResource,
}) => {
  if (classFeatures.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="w-5 h-5 text-blue-600" />
          Class Features
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {classFeatures.map((feature, index) => (
          <div key={index} className="border-l-4 border-blue-500 pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">{feature.name}</h4>
              <Badge variant="secondary" className="bg-blue-100 text-blue-800">
                {character.class?.name} {feature.level}
              </Badge>
              {feature.maxUses !== undefined && feature.currentUses !== undefined && (
                <Badge
                  variant={feature.currentUses === 0 ? 'destructive' : 'outline'}
                  className="ml-auto"
                >
                  {feature.currentUses} / {feature.maxUses}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
            {feature.maxUses !== undefined && feature.currentUses !== undefined && (
              <div className="mt-2">
                <div className="flex justify-between text-xs mb-1">
                  <span>Uses remaining</span>
                  <span>
                    {feature.currentUses} / {feature.maxUses}
                  </span>
                </div>
                <Progress
                  value={(feature.currentUses / feature.maxUses) * 100}
                  className="h-2"
                  aria-label={`${feature.name} uses`}
                />
              </div>
            )}
            {feature.currentUses !== undefined && feature.currentUses > 0 && (
              <Button
                size="sm"
                className="mt-2"
                onClick={() => onUseResource(feature.name)}
              >
                <Zap className="w-4 h-4 mr-2" />
                Use Feature
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
