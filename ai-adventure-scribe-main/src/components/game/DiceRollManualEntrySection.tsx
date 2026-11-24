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
  faceOnly?: boolean;
  error?: string | null;
}

export const DiceRollManualEntrySection: React.FC<DiceRollManualEntrySectionProps> = React.memo(
  ({
    manualMode,
    manualResult,
    resolvedFormula,
    onManualResultChange,
    onSubmit,
    onBackToRoll,
    onCancel,
    faceOnly = false,
    error = null,
  }) => {
    const manualInputId = useId();
    const errorId = useId();

    return (
      <div className="space-y-3">
        <div>
          <label
            htmlFor={manualInputId}
            className="text-sm text-slate-600 mb-1 block [body.ir-table-look_&]:!text-[#2a1a0c]"
          >
            {faceOnly
              ? 'Enter the number on the d20 (1–20):'
              : resolvedFormula === null && !manualMode
                ? 'Roll formula could not be resolved — enter your dice result:'
                : 'Enter your roll result:'}
          </label>
          <Input
            id={manualInputId}
            type="number"
            value={manualResult}
            onChange={(e) => onManualResultChange(e.target.value)}
            placeholder={faceOnly ? 'd20 face, 1–20' : 'Enter total result...'}
            className="text-center text-lg font-mono"
            min="1"
            max={faceOnly ? '20' : '100'}
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <p
              id={errorId}
              role="alert"
              className="mt-1 text-sm font-medium text-red-300 [body.ir-table-look_&]:!text-[#7a1016]"
            >
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            onClick={onSubmit}
            disabled={!manualResult || isNaN(parseInt(manualResult))}
            className="min-h-11 flex-1"
          >
            Submit
          </Button>
          {/* Only show "Back to Roll" when user voluntarily entered manual mode */}
          {manualMode && resolvedFormula !== null && (
            <Button
              type="button"
              variant="outline"
              onClick={onBackToRoll}
              className="min-h-11 flex-1"
            >
              Back to Roll
            </Button>
          )}
          {onCancel && !manualMode && (
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="min-h-11 flex-1 text-xs"
              size="sm"
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    );
  },
);
