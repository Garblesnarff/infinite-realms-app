/**
 * Condition Application Panel Component
 *
 * Allows DM and players to apply and manage D&D 5e conditions during combat.
 * Provides templates for common conditions with default durations and descriptions.
 */

import { UserX } from 'lucide-react';
import React, { useState, useId } from 'react';

import { CONDITION_ICONS, CONDITION_TEMPLATES } from './condition-utils';

import type { ConditionName, Condition, CombatParticipant } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ===========================
// Condition Application Component
// ===========================

interface ConditionApplicationPanelProps {
  onApplyCondition: (condition: Condition, targetId: string) => void;
  onRemoveCondition: (conditionName: ConditionName, targetId: string) => void;
  participants: CombatParticipant[];
}

/**
 * Panel for applying and managing conditions on combat participants.
 */
export const ConditionApplicationPanel: React.FC<ConditionApplicationPanelProps> = ({
  onApplyCondition,
  onRemoveCondition,
  participants,
}) => {
  const conditionSelectId = useId();
  const targetSelectId = useId();
  const durationInputId = useId();

  const [selectedCondition, setSelectedCondition] = useState<ConditionName | null>(null);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [conditionDuration, setConditionDuration] = useState<number>(3);

  const applicableConditions = Object.entries(CONDITION_TEMPLATES).filter(
    ([conditionName]) => conditionName !== 'surprised' && conditionName !== 'exhaustion',
  );

  const handleApplyCondition = (): void => {
    if (!selectedCondition || !selectedTarget) return;

    const template = CONDITION_TEMPLATES[selectedCondition];
    const condition: Condition = {
      name: selectedCondition,
      description: template.description,
      duration: conditionDuration === 0 ? template.defaultDuration : conditionDuration,
      saveEndsType: 'end',
      saveDC: 12, // Default DC - can be customized
      saveAbility: conditionDuration === 0 ? undefined : 'con', // Constitution save by default
      concentrationRequired: false,
    };

    onApplyCondition(condition, selectedTarget);
    setSelectedCondition(null);
    setSelectedTarget(null);
    setConditionDuration(3);
  };

  const hasAnyConditions = participants.some((p) => p.conditions.length > 0);

  return (
    <div className="space-y-4">
      <h4 className="font-semibold">Apply Condition</h4>

      <div className="space-y-3">
        <div>
          <label htmlFor={conditionSelectId} className="text-sm font-medium">
            Condition:
          </label>
          <Select
            value={selectedCondition || ''}
            onValueChange={(value) => setSelectedCondition(value as ConditionName)}
          >
            <SelectTrigger id={conditionSelectId} aria-label="Select condition">
              <SelectValue placeholder="Select a condition" />
            </SelectTrigger>
            <SelectContent>
              {applicableConditions.map(([conditionName, template]) => (
                <SelectItem key={conditionName} value={conditionName}>
                  <div className="flex items-center space-x-2">
                    {React.createElement(
                      CONDITION_ICONS[conditionName as ConditionName]?.icon || UserX,
                      {
                        className: 'w-4 h-4',
                      },
                    )}
                    <span>{template.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCondition && (
          <div>
            <label className="text-sm font-medium">Description:</label>
            <p className="text-xs text-gray-600 p-2 bg-gray-50 rounded">
              {CONDITION_TEMPLATES[selectedCondition].description}
            </p>
          </div>
        )}

        <div>
          <label htmlFor={targetSelectId} className="text-sm font-medium">
            Target:
          </label>
          <Select value={selectedTarget || ''} onValueChange={setSelectedTarget}>
            <SelectTrigger id={targetSelectId} aria-label="Select target">
              <SelectValue placeholder="Select target" />
            </SelectTrigger>
            <SelectContent>
              {participants.map((participant) => (
                <SelectItem key={participant.id} value={participant.id}>
                  {participant.name}
                  {participant.conditions.length > 0 && (
                    <Badge variant="outline" className="ml-2 text-xs">
                      {participant.conditions.length} conditions
                    </Badge>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label htmlFor={durationInputId} className="text-sm font-medium">
            Duration (rounds, 0 for save-based):
          </label>
          <Input
            id={durationInputId}
            type="number"
            min="0"
            value={conditionDuration}
            onChange={(e) => setConditionDuration(Number(e.target.value))}
            className="mt-1"
            placeholder="Duration in rounds"
          />
        </div>

        <Button
          onClick={handleApplyCondition}
          disabled={!selectedCondition || !selectedTarget}
          className="w-full"
          variant="default"
        >
          Apply {selectedCondition ? CONDITION_TEMPLATES[selectedCondition].name : 'Condition'}
        </Button>
      </div>

      {/* Current Conditions */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Managing Conditions:</label>
        <div className="space-y-1">
          {!hasAnyConditions ? (
            <p className="text-xs text-muted-foreground italic p-2 bg-muted/30 rounded border border-dashed text-center">
              No active conditions on participants.
            </p>
          ) : (
            participants.map((participant) =>
              participant.conditions.map((condition: Condition, index: number) => (
                <div
                  key={`${participant.id}-${condition.name}-${index}`}
                  className="flex items-center justify-between p-2 bg-gray-50 rounded"
                >
                  <div className="flex items-center space-x-2">
                    {React.createElement(CONDITION_ICONS[condition.name]?.icon || UserX, {
                      className: 'w-4 h-4',
                    })}
                    <span className="text-sm">
                      {condition.name} on {participant.name}
                    </span>
                    {condition.duration > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {condition.duration} rounds
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveCondition(condition.name, participant.id)}
                    className="text-red-600 hover:text-red-800 h-6 w-6 p-0"
                    aria-label={`Remove ${condition.name} from ${participant.name}`}
                    title={`Remove ${condition.name} from ${participant.name}`}
                  >
                    ×
                  </Button>
                </div>
              )),
            )
          )}
        </div>
      </div>
    </div>
  );
};
