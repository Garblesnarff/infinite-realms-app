import React from 'react';

import { COMBAT_ACTIONS, type ActionDefinition } from './ActionDefinitions';

import type { CombatParticipant } from '@/types/combat';

import { Button } from '@/components/ui/button';

interface CombatActionGridProps {
  currentParticipant?: CombatParticipant;
  onActionClick: (action: ActionDefinition) => void;
  isSubmitting: boolean;
}

/**
 * Grid of combat action buttons
 */
export const CombatActionGrid: React.FC<CombatActionGridProps> = ({
  currentParticipant,
  onActionClick,
  isSubmitting,
}) => {
  // Check if action is available for current participant
  const isActionAvailable = (action: ActionDefinition): boolean => {
    if (!currentParticipant) return false;

    if (action.actionRequired && currentParticipant.actionTaken) {
      return false;
    }

    if (action.bonusAction && currentParticipant.bonusActionTaken) {
      return false;
    }

    return true;
  };

  const getActionStatusText = (action: ActionDefinition): string => {
    if (!currentParticipant) return '';

    if (action.actionRequired && currentParticipant.actionTaken) {
      return 'Action Used';
    }

    if (action.bonusAction && currentParticipant.bonusActionTaken) {
      return 'Bonus Used';
    }

    return '';
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {COMBAT_ACTIONS.map((action) => {
        const available = isActionAvailable(action);
        const statusText = getActionStatusText(action);
        const ActionIcon = action.icon;

        return (
          <Button
            key={action.type}
            variant={available ? 'outline' : 'ghost'}
            className={`h-auto flex-col space-y-2 p-4 ${
              !available ? 'opacity-50 cursor-not-allowed' : 'hover:border-red-400'
            }`}
            onClick={() => {
              if (!available) return;
              onActionClick(action);
            }}
            disabled={!available || isSubmitting}
          >
            <ActionIcon
              className={`w-6 h-6 ${available ? 'text-gray-700' : 'text-gray-400'}`}
            />

            <div className="text-center">
              <div className="font-medium text-sm">{action.name}</div>
              {statusText && <div className="text-xs text-red-500 mt-1">{statusText}</div>}
            </div>
          </Button>
        );
      })}
    </div>
  );
};
