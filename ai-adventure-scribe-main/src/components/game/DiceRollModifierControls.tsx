import { ArrowUp, ArrowDown } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface DiceRollModifierControlsProps {
  hasAdvantage: boolean;
  hasDisadvantage: boolean;
  onToggleAdvantage: () => void;
  onToggleDisadvantage: () => void;
}

export const DiceRollModifierControls: React.FC<DiceRollModifierControlsProps> = React.memo(
  ({ hasAdvantage, hasDisadvantage, onToggleAdvantage, onToggleDisadvantage }) => (
    <TooltipProvider delayDuration={0}>
      <div className="flex gap-2 mt-3" role="group" aria-label="Roll modifiers">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={hasAdvantage ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleAdvantage}
              aria-pressed={hasAdvantage}
              aria-label={hasAdvantage ? 'Disable Advantage' : 'Enable Advantage'}
              className={cn(
                'text-xs',
                hasAdvantage
                  ? 'bg-green-600 text-white'
                  : 'text-green-600 border-green-600 hover:bg-green-50',
              )}
            >
              <ArrowUp className="w-3 h-3 mr-1" aria-hidden="true" />
              Advantage
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{hasAdvantage ? 'Disable Advantage' : 'Enable Advantage'}</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant={hasDisadvantage ? 'default' : 'outline'}
              size="sm"
              onClick={onToggleDisadvantage}
              aria-pressed={hasDisadvantage}
              aria-label={hasDisadvantage ? 'Disable Disadvantage' : 'Enable Disadvantage'}
              className={cn(
                'text-xs',
                hasDisadvantage
                  ? 'bg-red-600 text-white'
                  : 'text-red-600 border-red-600 hover:bg-red-50',
              )}
            >
              <ArrowDown className="w-3 h-3 mr-1" aria-hidden="true" />
              Disadvantage
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{hasDisadvantage ? 'Disable Disadvantage' : 'Enable Disadvantage'}</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  ),
);
