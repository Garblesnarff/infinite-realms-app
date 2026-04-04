/**
 * Combat Action Panel Component
 *
 * Replaces the normal chat input during combat with D&D 5e action buttons.
 * Provides quick access to standard actions while maintaining tabletop feel.
 * Actions are sent to the AI DM for narrative resolution.
 */

import { Dice6 } from 'lucide-react';
import React, { useState } from 'react';

import { type ActionDefinition, MANAGEMENT_ACTIONS } from './actions/ActionDefinitions';
import { CombatActionGrid } from './actions/CombatActionGrid';
import { CombatActionForm } from './CombatActionForm';
import { ConditionApplicationPanel } from './ConditionApplicationPanel';

import type { ActionType, ConditionName, Condition, CombatParticipant } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';

// ===========================
// Component Props
// ===========================

interface CombatActionPanelProps {
  onActionSubmit: (actionType: ActionType, description: string, additionalData?: unknown) => void;
  className?: string;
}

// ===========================
// Main Component
// ===========================

const CombatActionPanel: React.FC<CombatActionPanelProps> = ({
  onActionSubmit,
  className = '',
}) => {
  const { state, applyCondition, removeCondition } = useCombat();
  const { activeEncounter } = state;

  const [selectedAction, setSelectedAction] = useState<ActionDefinition | null>(null);
  const [selectedManagement, setSelectedManagement] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Unified submission handler that resets current selection
  const handleActionSubmit = async (
    type: ActionType,
    desc: string,
    data?: unknown,
  ): Promise<void> => {
    await onActionSubmit(type, desc, data);
    setSelectedAction(null);
  };

  // Handle management panel selection
  const handleManagementSelect = (managementType: string): void => {
    setSelectedManagement((prev) => (prev === managementType ? null : managementType));
  };

  const handleApplyCondition = async (condition: Condition, targetId: string): Promise<void> => {
    await applyCondition(targetId, condition);
  };

  const handleRemoveCondition = async (
    conditionName: ConditionName,
    targetId: string,
  ): Promise<void> => {
    await removeCondition(targetId, conditionName);
  };

  // Get current participant to check action availability
  const currentParticipant = activeEncounter?.participants.find(
    (p: CombatParticipant) => p.id === activeEncounter.currentTurnParticipantId,
  );

  const handleQuickAction = async (action: ActionDefinition): Promise<void> => {
    if (!action.quickAction) return;

    setIsSubmitting(true);
    try {
      await onActionSubmit(action.type, `${action.name}: ${action.description}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelAction = (): void => {
    setSelectedAction(null);
  };

  const handleActionClick = (action: ActionDefinition): void => {
    if (action.quickAction) {
      handleQuickAction(action);
    } else {
      setSelectedAction(action);
    }
  };

  return (
    <Card className={`w-full ${className}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Dice6 className="w-5 h-5 text-red-500" />
            <h3 className="font-semibold text-red-700">Combat Actions</h3>
          </div>
          {currentParticipant && (
            <div className="text-sm text-gray-600">{currentParticipant.name}'s Turn</div>
          )}
        </div>

        {/* Action Status */}
        {currentParticipant && (
          <div className="flex space-x-2">
            <Badge
              variant={currentParticipant.actionTaken ? 'default' : 'outline'}
              className="text-xs"
            >
              Action {currentParticipant.actionTaken ? 'Used' : 'Available'}
            </Badge>
            <Badge
              variant={currentParticipant.bonusActionTaken ? 'default' : 'outline'}
              className="text-xs"
            >
              Bonus {currentParticipant.bonusActionTaken ? 'Used' : 'Available'}
            </Badge>
            <Badge
              variant={currentParticipant.reactionTaken ? 'default' : 'outline'}
              className="text-xs"
            >
              Reaction {currentParticipant.reactionTaken ? 'Used' : 'Available'}
            </Badge>
          </div>
        )}

        {/* Management Actions */}
        <div className="flex justify-end space-x-2">
          {MANAGEMENT_ACTIONS.map((action) => {
            const isActive = selectedManagement === action.type;
            return (
              <Button
                key={action.type}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleManagementSelect(action.type)}
                className={isActive ? 'bg-purple-600 text-white hover:bg-purple-700' : 'text-purple-600'}
                title={action.description}
                aria-label={action.name}
                aria-pressed={isActive}
              >
                <action.icon className="w-4 h-4 mr-1" aria-hidden="true" />
                {action.name.replace('Manage ', '')}
              </Button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent>
        {/* Selected Management Panel */}
        {selectedManagement ? (
          <div className="space-y-4">
            {selectedManagement === 'manage_conditions' && (
              <ConditionApplicationPanel
                onApplyCondition={handleApplyCondition}
                onRemoveCondition={handleRemoveCondition}
                participants={activeEncounter?.participants || []}
              />
            )}
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setSelectedManagement(null)}>
                Back to Actions
              </Button>
            </div>
          </div>
        ) : selectedAction ? (
          <CombatActionForm
            selectedAction={selectedAction}
            onActionSubmit={handleActionSubmit}
            onCancel={handleCancelAction}
          />
        ) : (
          // Integrated SpellSlotPanel for cast_spell actions
          /* Action Selection Grid */
          <div className="space-y-4">
            <CombatActionGrid
              currentParticipant={currentParticipant}
              onActionClick={handleActionClick}
              isSubmitting={isSubmitting}
            />

            <Separator />

            {/* Movement & Free Actions */}
            <div className="text-center">
              <p className="text-sm text-gray-500">
                Movement: {currentParticipant?.movementUsed || 0} ft used this turn
              </p>
              <p className="text-xs text-gray-400 mt-1">
                Free actions like talking can be done anytime
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default CombatActionPanel;
