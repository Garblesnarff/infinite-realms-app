import React from 'react';

import type { ActionType, CombatEncounter as Encounter } from '@/types/combat';
import type { SpellSlotLevel } from '@/types/combat-features';

import { Button } from '@/components/ui/button';
import DiceRoller from '@/components/ui/dice-roller';

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
  onRollInitiative: (participantId: string) => void;
  showInitiativeRoll?: boolean;
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
    showInitiativeRoll = false,
    onTwoWeaponAttack,
    onEnhancedAttack,
  }) => {
    return (
      <div className="flex gap-2 flex-wrap">
        {showInitiativeRoll && (
          <DiceRoller
            dice="1d20"
            label="Initiative"
            modifier={0}
            onRoll={() => onRollInitiative(currentParticipant.id)}
          />
        )}
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
          onClick={() => onTwoWeaponAttack(currentParticipant.id, selectedEnemyId || undefined)}
        >
          Two-Weapon Attack
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
