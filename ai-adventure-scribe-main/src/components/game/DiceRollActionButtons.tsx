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

export const DiceRollActionButtons: React.FC<DiceRollActionButtonsProps> = React.memo(
  ({ formula, purpose, isRolling, onAutoRoll, onEnterManually, onCancel }) => (
    <TooltipProvider>
      <div className="flex flex-wrap gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              onClick={onAutoRoll}
              disabled={isRolling}
              variant="ir-gold"
              className="min-h-11 flex-[2_1_8rem] font-semibold"
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

        <div className="flex flex-[3_1_14rem] gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                onClick={onEnterManually}
                disabled={isRolling}
                className="min-h-11 flex-1 border-white/20 bg-white/[0.03] text-sm text-foreground hover:bg-white/10"
                aria-label="Enter my own roll: roll physical dice and enter result manually"
              >
                Enter my own roll
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
                  className="min-h-11 flex-1 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground"
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
  ),
);
