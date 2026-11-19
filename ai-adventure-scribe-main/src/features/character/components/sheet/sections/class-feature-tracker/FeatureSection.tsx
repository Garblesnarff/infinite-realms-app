import { Star, Zap } from 'lucide-react';
import React, { useId } from 'react';

import type { Character } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { useIsInCombatOptional } from '@/contexts/in-combat-flag';
import { useSheetHitPointsOptional } from '@/contexts/sheet-hit-points';

interface FeatureSectionProps {
  character: Character;
  classFeatures: ClassFeature[];
  onUseResource: (feature: ClassFeature) => void;
}

/**
 * FeatureSection displays character class features with usage tracking
 */
export const FeatureSection: React.FC<FeatureSectionProps> = ({
  character,
  classFeatures,
  onUseResource,
}) => {
  // #1679: Second Wind is refused at full HP and in a fight, so its button says why (as Heal self
  // does, #1658). The reason is the button's description.
  const inCombat = useIsInCombatOptional();
  const hitPoints = useSheetHitPointsOptional();
  const secondWindHintId = useId();
  const secondWindRefusal = inCombat
    ? 'In combat, use Second Wind from the combat actions.'
    : hitPoints !== null && hitPoints.current >= hitPoints.maximum
      ? 'You are already at full health.'
      : null;

  if (classFeatures.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="w-5 h-5 text-infinite-teal" />
          Class Features
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {classFeatures.map((feature, index) => (
          <div key={index} className="border-l-4 border-infinite-teal pl-4">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-semibold">{feature.displayName ?? feature.name}</h4>
              <Badge variant="secondary" className="bg-infinite-teal/15 text-infinite-teal">
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
                  aria-label={`${feature.displayName ?? feature.name} uses`}
                />
              </div>
            )}
            {/* #1618: Lay on Hands spends through its own control (LayOnHandsControl), not the generic button. */}
            {feature.name !== 'lay_on_hands' &&
              feature.currentUses !== undefined &&
              feature.currentUses > 0 && (
                <Button
                  size="sm"
                  className="mt-2"
                  disabled={feature.name === 'second_wind' && secondWindRefusal !== null}
                  aria-describedby={
                    feature.name === 'second_wind' && secondWindRefusal !== null
                      ? secondWindHintId
                      : undefined
                  }
                  onClick={() => onUseResource(feature)}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Use Feature
                </Button>
              )}
            {feature.name === 'second_wind' && secondWindRefusal !== null && (
              <p id={secondWindHintId} className="mt-1 text-xs text-muted-foreground">
                {secondWindRefusal}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
};
