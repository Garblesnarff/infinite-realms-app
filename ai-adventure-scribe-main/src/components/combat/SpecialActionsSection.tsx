import React from 'react';

import type { ActionType, CombatEncounter as Encounter } from '@/types/combat';
import type { SpellSlotLevel } from '@/types/combat-features';

import { Button } from '@/components/ui/button';

type Participant = Encounter['participants'][number];

const SMITE_SLOT_LEVELS: SpellSlotLevel[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];

interface SpecialActionsSectionProps {
  currentParticipant: Participant;
  selectedEnemyId: string | null;
  onCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: unknown,
  ) => void;
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
  ({ currentParticipant, selectedEnemyId, onCombatAction, onEnhancedAttack }) => {
    return (
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedEnemyId}
          onClick={() =>
            onCombatAction('grapple', currentParticipant.id, selectedEnemyId || undefined)
          }
        >
          Grapple
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedEnemyId}
          onClick={() =>
            onCombatAction('shove', currentParticipant.id, selectedEnemyId || undefined)
          }
        >
          Shove
        </Button>
        {/* #1362: one button per slot level the Paladin has left, read from the participant
            the action bar already holds. The chosen level travels with the attack. */}
        {currentParticipant.characterClass === 'paladin' &&
          SMITE_SLOT_LEVELS.filter(
            (level) => (currentParticipant.spellSlots?.[level]?.current ?? 0) > 0,
          ).map((level) => (
            <Button
              key={level}
              variant="outline"
              size="sm"
              onClick={() =>
                onEnhancedAttack(
                  currentParticipant.id,
                  selectedEnemyId || undefined,
                  'divine_smite',
                  false,
                  false,
                  level,
                )
              }
            >
              Divine Smite ({ORDINALS[level - 1]})
            </Button>
          ))}
      </div>
    );
  },
);

SpecialActionsSection.displayName = 'SpecialActionsSection';
