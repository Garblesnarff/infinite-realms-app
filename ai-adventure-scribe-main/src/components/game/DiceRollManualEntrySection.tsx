import React, { useId } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface DiceRollManualEntrySectionProps {
  manualMode: boolean;
  manualResult: string;
  resolvedFormula: string | null;
  onManualResultChange: (value: string) => void;
  onSubmit: () => void;
  onBackToRoll: () => void;
  onCancel?: () => void;
}

export const DiceRollManualEntrySection: React.FC<DiceRollManualEntrySectionProps> = ({
  manualMode,
  manualResult,
  resolvedFormula,
  onManualResultChange,
  onSubmit,
  onBackToRoll,
  onCancel,
}) => {
  const manualInputId = useId();

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={manualInputId} className="text-sm text-slate-600 mb-1 block">
          {resolvedFormula === null && !manualMode
            ? 'Roll formula could not be resolved — enter your dice result:'
            : 'Enter your roll result:'}
        </label>
        <Input
          id={manualInputId}
          type="number"
          value={manualResult}
          onChange={(e) => onManualResultChange(e.target.value)}
          placeholder="Enter total result..."
          className="text-center text-lg font-mono"
          min="1"
          max="100"
        />
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          onClick={onSubmit}
          disabled={!manualResult || isNaN(parseInt(manualResult))}
          className="flex-1"
        >
          Submit
        </Button>
        {/* Only show "Back to Roll" when user voluntarily entered manual mode */}
        {manualMode && resolvedFormula !== null && (
          <Button type="button" variant="outline" onClick={onBackToRoll} className="flex-1">
            Back to Roll
          </Button>
        )}
        {onCancel && !manualMode && (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            className="flex-1 text-xs"
            size="sm"
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
};
