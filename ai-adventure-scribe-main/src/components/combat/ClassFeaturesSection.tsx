import { Flame, Zap } from 'lucide-react';
import React from 'react';

import type { Encounter } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { canUseClassFeature } from '@/utils/classFeatures';

type Participant = Encounter['participants'][number];

interface ClassFeaturesSectionProps {
  currentParticipant: Participant;
  onClassFeatureUse: (participantId: string, featureName: string) => void;
}

export const ClassFeaturesSection: React.FC<ClassFeaturesSectionProps> = React.memo(
  ({ currentParticipant, onClassFeatureUse }) => {
    if (!currentParticipant.classFeatures) {
      return null;
    }

    return (
      <div className="flex gap-2 flex-wrap">
        {currentParticipant.classFeatures
          .filter((feature) => feature.type !== 'passive')
          .map((feature) => {
            const canUse = canUseClassFeature(
              feature,
              (currentParticipant.resources || {}) as unknown as Record<string, number>,
            );
            return (
              <Button
                key={feature.name}
                variant="outline"
                size="sm"
                onClick={() => onClassFeatureUse(currentParticipant.id, feature.name)}
                disabled={!canUse}
                className={
                  currentParticipant.isRaging && feature.name === 'rage'
                    ? 'bg-red-500 text-white'
                    : ''
                }
              >
                {feature.name === 'rage' && currentParticipant.isRaging ? (
                  <>
                    <Flame className="w-4 h-4 mr-1" />
                    Stop Raging
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-1" />
                    {feature.name.replace('_', ' ')}
                  </>
                )}
                {feature.maxUses && (
                  <span className="ml-1 text-xs">
                    ({feature.currentUses || 0}/{feature.maxUses})
                  </span>
                )}
              </Button>
            );
          })}
      </div>
    );
  },
);

ClassFeaturesSection.displayName = 'ClassFeaturesSection';
