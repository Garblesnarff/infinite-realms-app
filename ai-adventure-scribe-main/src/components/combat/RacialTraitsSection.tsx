import React from 'react';

import type { Encounter } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { canUseRacialTrait } from '@/utils/racialTraits';

type Participant = Encounter['participants'][number];

interface RacialTraitsSectionProps {
  currentParticipant: Participant;
  onRacialTraitUse: (participantId: string, traitName: string) => void;
}

export const RacialTraitsSection: React.FC<RacialTraitsSectionProps> = React.memo(
  ({ currentParticipant, onRacialTraitUse }) => {
    if (!currentParticipant.racialTraits) {
      return null;
    }

    const activeTraits = currentParticipant.racialTraits.filter(
      (trait) => trait.type === 'active' && canUseRacialTrait(trait),
    );

    if (activeTraits.length === 0) {
      return null;
    }

    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">Racial Traits:</div>
        <div className="flex gap-2 flex-wrap">
          {activeTraits.map((trait) => (
            <Button
              key={trait.name}
              variant="outline"
              size="sm"
              onClick={() => onRacialTraitUse(currentParticipant.id, trait.name)}
              className="bg-green-50 hover:bg-green-100 border-green-200"
            >
              {trait.name.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
              {trait.currentUses !== undefined && (
                <span className="ml-1 text-xs">
                  ({trait.currentUses}/{trait.maxUses})
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>
    );
  },
);

RacialTraitsSection.displayName = 'RacialTraitsSection';
