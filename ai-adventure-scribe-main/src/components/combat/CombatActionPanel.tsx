/**
 * Combat Action Panel Component
 *
 * Replaces the normal chat input during combat with D&D 5e action buttons.
 * Provides quick access to standard actions while maintaining tabletop feel.
 * Actions are sent to the AI DM for narrative resolution.
 */

import {
  MessageSquare,
  Dice6,
  RotateCcw,
} from 'lucide-react';
import React, { useState } from 'react';

import { type ActionDefinition, MANAGEMENT_ACTIONS } from './actions/ActionDefinitions';
import { CombatActionGrid } from './actions/CombatActionGrid';
import { ConditionApplicationPanel } from './ConditionApplicationPanel';

import type { ActionType, ConditionName, Condition, CombatParticipant } from '@/types/combat';

import SpellSlotPanel from '@/components/spellcasting/SpellSlotPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
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
  const [actionDetails, setActionDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState<string | null>(null);
  const [selectedSpellLevel, setSelectedSpellLevel] = useState<number>(1);
  const [hitDiceToRoll, setHitDiceToRoll] = useState<number>(1);

  // Handle management panel selection
  const handleManagementSelect = (managementType: string): void => {
    setSelectedManagement(managementType);
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

  const handleDetailedAction = async (): Promise<void> => {
    if (!selectedAction) return;

    setIsSubmitting(true);
    try {
      // For spell casting, include spell details
      if (selectedAction.type === 'cast_spell') {
        if (!selectedSpell) {
          logger.error('No spell selected');
          return;
        }
        await onActionSubmit(selectedAction.type, actionDetails, {
          spellName: selectedSpell,
          spellLevel: selectedSpellLevel,
        });
      }
      // For rest actions, include hit dice selection
      else if (selectedAction.type === 'short_rest' || selectedAction.type === 'long_rest') {
        await onActionSubmit(selectedAction.type, actionDetails, { hitDiceToRoll });
      } else {
        await onActionSubmit(selectedAction.type, actionDetails);
      }
      setSelectedAction(null);
      setActionDetails('');
      setSelectedSpell(null);
      setSelectedSpellLevel(1);
      setHitDiceToRoll(1);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelAction = (): void => {
    setSelectedAction(null);
    setActionDetails('');
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
          {MANAGEMENT_ACTIONS.map((action) => (
            <Button
              key={action.type}
              variant="outline"
              size="sm"
              onClick={() => handleManagementSelect(action.type)}
              className="text-purple-600"
            >
              <action.icon className="w-4 h-4 mr-1" />
              {action.name.replace('Manage ', '')}
            </Button>
          ))}
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
          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <selectedAction.icon className="w-5 h-5" />
              <h4 className="font-semibold">{selectedAction.name}</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancelAction}
                disabled={isSubmitting}
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>

            <p className="text-sm text-gray-600">{selectedAction.description}</p>

            {selectedAction.type === 'cast_spell' ? (
              <SpellSlotPanel
                onSpellSelect={(spellName, level) => {
                  setSelectedSpell(spellName);
                  setSelectedSpellLevel(level);
                  setActionDetails(`Cast ${spellName} at level ${level}`);
                }}
                availableSpells={['Fire Bolt', 'Magic Missile', 'Cure Wounds', 'Healing Word']} // From character data
              />
            ) : selectedAction.type === 'short_rest' || selectedAction.type === 'long_rest' ? (
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">Hit dice to roll:</label>
                  <Input
                    type="number"
                    min="1"
                    value={hitDiceToRoll}
                    onChange={(e) => setHitDiceToRoll(Number(e.target.value))}
                    className="mt-1"
                    placeholder="Number of hit dice"
                  />
                </div>
                <div className="flex space-x-2">
                  <Button
                    onClick={() => {
                      setActionDetails(`${selectedAction.name}: Rolling ${hitDiceToRoll} hit dice`);
                      handleDetailedAction();
                    }}
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    Take {selectedAction.name}
                  </Button>
                </div>
              </div>
            ) : (
              <Textarea
                placeholder={`Describe your ${selectedAction.name.toLowerCase()}...`}
                value={actionDetails}
                onChange={(e) => setActionDetails(e.target.value)}
                className="min-h-[100px]"
                disabled={isSubmitting}
              />
            )}

            {selectedAction.type !== 'cast_spell' &&
              selectedAction.type !== 'short_rest' &&
              selectedAction.type !== 'long_rest' && (
                <div className="flex space-x-2">
                  <Button
                    onClick={handleDetailedAction}
                    disabled={!actionDetails.trim() || isSubmitting}
                    className="flex-1"
                  >
                    <MessageSquare className="w-4 h-4 mr-2" />
                    {isSubmitting ? 'Submitting...' : `Take ${selectedAction.name}`}
                  </Button>

                  <Button variant="outline" onClick={handleCancelAction} disabled={isSubmitting}>
                    Cancel
                  </Button>
                </div>
              )}
          </div>
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
