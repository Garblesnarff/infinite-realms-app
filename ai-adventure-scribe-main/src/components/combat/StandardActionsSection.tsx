import React from 'react';

import type { ActionType, Encounter } from '@/types/combat';

import { Button } from '@/components/ui/button';

type Participant = Encounter['participants'][number];

interface StandardActionsSectionProps {
  currentParticipant: Participant;
  onCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: unknown,
  ) => void;
}

export const StandardActionsSection: React.FC<StandardActionsSectionProps> = React.memo(
  ({ currentParticipant, onCombatAction }) => {
    return (
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCombatAction('dash', currentParticipant.id)}
        >
          Dash
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCombatAction('dodge', currentParticipant.id)}
        >
          Dodge
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCombatAction('help', currentParticipant.id)}
        >
          Help
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCombatAction('hide', currentParticipant.id)}
        >
          Hide
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCombatAction('ready', currentParticipant.id)}
        >
          Ready Action
        </Button>
      </div>
    );
  },
);

StandardActionsSection.displayName = 'StandardActionsSection';
