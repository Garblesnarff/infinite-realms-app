import { Play, AlertTriangle } from 'lucide-react';
import React from 'react';

import { ClassFeaturesSection } from './ClassFeaturesSection';
import { ParticipantStatusSection } from './ParticipantStatusSection';
import { RacialTraitsSection } from './RacialTraitsSection';
import { SpecialActionsSection } from './SpecialActionsSection';
import { StandardActionsSection } from './StandardActionsSection';

import type { ActionType, Encounter } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ActionPanelProps {
  activeEncounter: Encounter;
  currentParticipantId: string;
  selectedEnemyId: string | null;
  actionValidation: {
    isValid: boolean;
    suggestions: string[];
    errors: string[];
  } | null;
  onCombatAction: (
    actionType: ActionType,
    participantId: string,
    targetId?: string,
    additionalData?: unknown,
  ) => void;
  onNextTurn: () => void;
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
  onClassFeatureUse: (participantId: string, featureName: string) => void;
  onRacialTraitUse: (participantId: string, traitName: string) => void;
  onDeathSave: (participantId: string) => void;
  showNextTurnButton?: boolean;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent unnecessary re-renders of the combat action panel
 * when unrelated combat state changes occur. This is a high-frequency component
 * during active encounters.
 */
const ActionPanel: React.FC<ActionPanelProps> = React.memo(
  ({
    activeEncounter,
    currentParticipantId,
    selectedEnemyId,
    actionValidation,
    onCombatAction,
    onNextTurn,
    onRollInitiative,
    onTwoWeaponAttack,
    onEnhancedAttack,
    onClassFeatureUse,
    onRacialTraitUse,
    onDeathSave,
    showNextTurnButton = true,
  }) => {
    const currentParticipant = activeEncounter.participants.find(
      (p) => p.id === currentParticipantId,
    );

    if (!currentParticipant) {
      return null;
    }

    return (
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="w-3 h-3 bg-amber-500 rounded-full animate-pulse cursor-help focus-visible:ring-2 focus-visible:ring-amber-500 outline-none"
                    role="status"
                    aria-label="Current turn indicator"
                    tabIndex={0}
                  ></div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Current Turn</p>
                </TooltipContent>
              </Tooltip>
              <span className="font-semibold">{currentParticipant.name}'s Turn</span>
            </div>
            {showNextTurnButton && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onNextTurn}
                    aria-label="Next Turn - End turn and advance to next participant"
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Next Turn
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>End turn and advance to next participant</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <Separator className="my-3" />

          {actionValidation && !actionValidation.isValid && (
            <div className="mb-3 p-2 bg-destructive/10 border border-destructive/20 rounded-md">
              <div className="flex items-center gap-2 text-destructive text-sm font-medium">
                <AlertTriangle className="w-4 h-4" />
                Action Invalid
              </div>
              <ul className="text-xs text-destructive/80 mt-1 ml-6">
                {actionValidation.errors.map((error, i) => (
                  <li key={i}>• {error}</li>
                ))}
              </ul>
            </div>
          )}

          {actionValidation && actionValidation.suggestions.length > 0 && (
            <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-md">
              <div className="text-amber-800 text-sm font-medium">Tactical Suggestions</div>
              <ul className="text-xs text-amber-700 mt-1">
                {actionValidation.suggestions.map((suggestion, i) => (
                  <li key={i}>• {suggestion}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <SpecialActionsSection
              currentParticipant={currentParticipant}
              selectedEnemyId={selectedEnemyId}
              onCombatAction={onCombatAction}
              onRollInitiative={onRollInitiative}
              onTwoWeaponAttack={onTwoWeaponAttack}
              onEnhancedAttack={onEnhancedAttack}
            />

            <StandardActionsSection
              currentParticipant={currentParticipant}
              onCombatAction={onCombatAction}
            />

            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onCombatAction('cast_spell', currentParticipant.id)}
              >
                Cast Spell
              </Button>
            </div>

            <ClassFeaturesSection
              currentParticipant={currentParticipant}
              onClassFeatureUse={onClassFeatureUse}
            />

            <RacialTraitsSection
              currentParticipant={currentParticipant}
              onRacialTraitUse={onRacialTraitUse}
            />

            <ParticipantStatusSection
              currentParticipant={currentParticipant}
              onDeathSave={onDeathSave}
            />
          </div>
        </CardContent>
      </Card>
    );
  },
);

ActionPanel.displayName = 'ActionPanel';

export default ActionPanel;
