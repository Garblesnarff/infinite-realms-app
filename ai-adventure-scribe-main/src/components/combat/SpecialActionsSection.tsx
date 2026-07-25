import React from 'react';

import type { ActionType, Encounter } from '@/types/combat';

import { Button } from '@/components/ui/button';
import DiceRoller from '@/components/ui/dice-roller';

type Participant = Encounter['participants'][number];

interface SpecialActionsSectionProps {
  currentParticipant: Participant;
  selectedEnemyId: string | null;
  onCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: unknown,
  ) => void;
  onRollInitiative: (participantId: string) => void;
  onTwoWeaponAttack: (participantId: string, targetId?: string) => void;
  onEnhancedAttack: (
    participantId: string,
    targetId?: string,
    actionType?: ActionType,
    hasAdvantage?: boolean,
    hasDisadvantage?: boolean,
    divineSmiteSlotLevel?: number,
  ) => void;
}

export const SpecialActionsSection: React.FC<SpecialActionsSectionProps> = React.memo(
  ({
    currentParticipant,
    selectedEnemyId,
    onCombatAction,
    onRollInitiative,
    onTwoWeaponAttack,
    onEnhancedAttack,
  }) => {
    return (
      <div className="flex gap-2 flex-wrap">
        <DiceRoller
          dice="1d20"
          label="Initiative"
          modifier={0}
          onRoll={() => onRollInitiative(currentParticipant.id)}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onCombatAction('grapple', currentParticipant.id, selectedEnemyId || undefined)
          }
        >
          Grapple
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onCombatAction('shove', currentParticipant.id, selectedEnemyId || undefined)
          }
        >
          Shove
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onTwoWeaponAttack(currentParticipant.id, selectedEnemyId || undefined)
          }
        >
          Two-Weapon Attack
        </Button>
        {currentParticipant.characterClass === 'paladin' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              onEnhancedAttack(
                currentParticipant.id,
                selectedEnemyId || undefined,
                'divine_smite',
                false,
                false,
                1,
              )
            }
          >
            Divine Smite (1st)
          </Button>
        )}
      </div>
    );
  },
);

SpecialActionsSection.displayName = 'SpecialActionsSection';
