import { MessageSquare, RotateCcw } from 'lucide-react';
import React, { useState, useId } from 'react';

import type { ActionDefinition } from './actions/ActionDefinitions';
import type { ActionType } from '@/types/combat';

import SpellSlotPanel from '@/components/spellcasting/SpellSlotPanel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import logger from '@/lib/logger';

interface CombatActionFormProps {
  selectedAction: ActionDefinition;
  onActionSubmit: (actionType: ActionType, description: string, additionalData?: unknown) => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Extracted form for detailed combat actions.
 * Handles state and submission for specific actions like casting spells or resting.
 */
export const CombatActionForm: React.FC<CombatActionFormProps> = ({
  selectedAction,
  onActionSubmit,
  onCancel,
}) => {
  const hitDiceInputId = useId();
  const actionDetailsId = useId();
  const [actionDetails, setActionDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedSpell, setSelectedSpell] = useState<string | null>(null);
  const [selectedSpellLevel, setSelectedSpellLevel] = useState<number>(1);
  const [hitDiceToRoll, setHitDiceToRoll] = useState<number>(1);

  const handleSubmit = async (): Promise<void> => {
    setIsSubmitting(true);
    try {
      let finalDetails = actionDetails;
      let additionalData: unknown = undefined;

      // For spell casting, include spell details
      if (selectedAction.type === 'cast_spell') {
        if (!selectedSpell) {
          logger.error('No spell selected');
          setIsSubmitting(false);
          return;
        }
        additionalData = {
          spellName: selectedSpell,
          spellLevel: selectedSpellLevel,
        };
      }
      // For rest actions, include hit dice selection
      else if (selectedAction.type === 'short_rest' || selectedAction.type === 'long_rest') {
        finalDetails = `${selectedAction.name}: Rolling ${hitDiceToRoll} hit dice`;
        additionalData = { hitDiceToRoll };
      }

      await onActionSubmit(selectedAction.type, finalDetails, additionalData);

      // Reset local state (parent will usually unmount this component anyway)
      setActionDetails('');
      setSelectedSpell(null);
      setSelectedSpellLevel(1);
      setHitDiceToRoll(1);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-4">
        <div className="flex items-center space-x-2">
          <selectedAction.icon className="w-5 h-5" />
          <h4 className="font-semibold">{selectedAction.name}</h4>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                disabled={isSubmitting}
                aria-label="Cancel current action and return to list"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Cancel current action and return to list</p>
            </TooltipContent>
          </Tooltip>
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
            <Label htmlFor={hitDiceInputId} className="text-sm font-medium">
              Hit dice to roll:
            </Label>
            <Input
              id={hitDiceInputId}
              type="number"
              min="1"
              value={hitDiceToRoll}
              onChange={(e) => setHitDiceToRoll(Number(e.target.value))}
              className="mt-1"
              placeholder="Number of hit dice"
            />
          </div>
          <div className="flex space-x-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="flex-1"
                  aria-label={`Submit ${selectedAction.name} and roll ${hitDiceToRoll} hit dice`}
                >
                  Take {selectedAction.name}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Submit {selectedAction.name} and roll {hitDiceToRoll} hit dice</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={actionDetailsId} className="text-sm font-medium">
            Action Details
          </Label>
          <Textarea
            id={actionDetailsId}
            placeholder={`Describe your ${selectedAction.name.toLowerCase()}...`}
            value={actionDetails}
            onChange={(e) => setActionDetails(e.target.value)}
            className="min-h-[100px]"
            disabled={isSubmitting}
          />
        </div>
      )}

      {selectedAction.type !== 'cast_spell' &&
        selectedAction.type !== 'short_rest' &&
        selectedAction.type !== 'long_rest' && (
          <div className="flex space-x-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!actionDetails.trim() || isSubmitting}
                  className="flex-1"
                  aria-label={`Submit ${selectedAction.name} action`}
                >
                  <MessageSquare className="w-4 h-4 mr-2" aria-hidden="true" />
                  {isSubmitting ? 'Submitting...' : `Take ${selectedAction.name}`}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Submit {selectedAction.name} action</p>
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isSubmitting}
                  aria-label="Cancel and return to action list"
                >
                  Cancel
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Cancel and return to action list</p>
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
