import React from 'react';

import DeathSaveManager from './DeathSaveManager';

import type { Encounter } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { needsDeathSaves } from '@/utils/combat/deathSaves';

type Participant = Encounter['participants'][number];

interface ParticipantStatusSectionProps {
  currentParticipant: Participant;
  onDeathSave: (participantId: string) => void;
}

export const ParticipantStatusSection: React.FC<ParticipantStatusSectionProps> = React.memo(
  ({ currentParticipant, onDeathSave }) => {
    const isDying = needsDeathSaves(currentParticipant);
    const isDead = currentParticipant.isDead || false;
    const hasConditions =
      currentParticipant.conditions && currentParticipant.conditions.length > 0;
    const hasConcentration = currentParticipant.activeConcentration;

    if (!hasConditions && !isDying && !isDead && !hasConcentration) {
      return null;
    }

    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-muted-foreground">Status:</div>
        <div className="flex gap-2 flex-wrap items-center">
          {hasConcentration && (
            <Badge variant="outline" className="border-blue-500 text-blue-700">
              Concentrating
            </Badge>
          )}
          {isDying && (
            <DeathSaveManager participant={currentParticipant} onDeathSave={onDeathSave} />
          )}
          {isDead && <Badge variant="destructive">Dead</Badge>}
          {hasConditions &&
            currentParticipant.conditions.map((condition) => (
              <Badge
                key={condition.name}
                variant="outline"
                className="border-orange-500 text-orange-700"
              >
                {condition.name.charAt(0).toUpperCase() + condition.name.slice(1)}
              </Badge>
            ))}
        </div>
      </div>
    );
  },
);

ParticipantStatusSection.displayName = 'ParticipantStatusSection';
