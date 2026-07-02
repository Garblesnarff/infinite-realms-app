import { Dice6 } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface DiceRollActionButtonsProps {
  formula: string;
  purpose: string;
  isRolling: boolean;
  onAutoRoll: () => void;
  onEnterManually: () => void;
  onCancel?: () => void;
}

export const DiceRollActionButtons: React.FC<DiceRollActionButtonsProps> = ({
  formula,
  purpose,
  isRolling,
  onAutoRoll,
  onEnterManually,
  onCancel,
}) => (
  <TooltipProvider>
    <div className="space-y-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            onClick={onAutoRoll}
            disabled={isRolling}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
            size="lg"
            aria-label={`Roll ${formula} for ${purpose}`}
          >
            <Dice6 className="w-4 h-4 mr-2" aria-hidden="true" />
            {isRolling ? 'Rolling...' : 'Roll Dice'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{`Roll ${formula} for ${purpose}`}</p>
        </TooltipContent>
      </Tooltip>

      <div className="flex gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              onClick={onEnterManually}
              disabled={isRolling}
              className="flex-1 text-xs"
              size="sm"
              aria-label="Roll physical dice and enter result manually"
            >
              Enter Manually
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Roll physical dice and enter result manually</p>
          </TooltipContent>
        </Tooltip>

        {onCancel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                onClick={onCancel}
                disabled={isRolling}
                className="flex-1 text-xs"
                size="sm"
                aria-label="Dismiss roll request"
              >
                Cancel
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Dismiss roll request</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  </TooltipProvider>
);
