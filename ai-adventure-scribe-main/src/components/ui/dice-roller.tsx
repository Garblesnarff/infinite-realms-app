import { Dice6, Plus, Minus } from 'lucide-react';
import React, { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface DiceRollResult {
  total: number;
  rolls: number[];
  modifier: number;
  advantage?: boolean;
  disadvantage?: boolean;
  timestamp: Date;
}

interface DiceRollerProps {
  dice: string; // e.g., "1d20", "2d6+3"
  modifier?: number;
  label?: string;
  className?: string;
  onRoll?: (result: DiceRollResult) => void;
  advantage?: boolean;
  disadvantage?: boolean;
  disabled?: boolean;
  displayOnly?: boolean;
}

/**
 * Interactive dice rolling component with advantage/disadvantage support
 * Mimics Roll20's click-to-roll functionality
 */
const DiceRoller: React.FC<DiceRollerProps> = ({
  dice,
  modifier = 0,
  label,
  className,
  onRoll,
  advantage = false,
  disadvantage = false,
  disabled = false,
  displayOnly = false,
}) => {
  const [lastRoll, setLastRoll] = useState<DiceRollResult | null>(null);
  const [isRolling, setIsRolling] = useState(false);

  const parseDiceString = (diceStr: string) => {
    const parts = diceStr.replace(/\s+/g, '').match(/[+-]?\d*d\d+|[+-]?\d+/g) || [];
    const groups: Array<{ count: number; sides: number }> = [];
    let mod = 0;
    for (const part of parts) {
      if (!part.includes('d')) { mod += Number(part); continue; }
      const [rawCount, rawSides] = part.split('d');
      const count = rawCount === '-' ? -1 : rawCount === '' || rawCount === '+' ? 1 : Number(rawCount);
      groups.push({ count, sides: Number(rawSides) });
    }
    if (!groups.length) groups.push({ count: 1, sides: 20 });
    return { count: groups[0].count, sides: groups[0].sides, mod, groups };
  };

  const rollDice = (sides: number): number => {
    return Math.floor(Math.random() * sides) + 1;
  };

  const performRoll = async () => {
    if (disabled || isRolling) return;

    setIsRolling(true);

    // Add slight delay for visual feedback
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { count, sides, mod, groups } = parseDiceString(dice);
    let rolls: number[] = [];

    // Handle advantage/disadvantage for d20 rolls
    if (sides === 20 && count === 1 && (advantage || disadvantage)) {
      const roll1 = rollDice(sides);
      const roll2 = rollDice(sides);

      if (advantage) {
        rolls = [Math.max(roll1, roll2)];
      } else {
        rolls = [Math.min(roll1, roll2)];
      }
    } else {
      for (const group of groups) {
        for (let i = 0; i < Math.abs(group.count); i++) {
          rolls.push(rollDice(group.sides) * Math.sign(group.count));
        }
      }
    }

    const total = rolls.reduce((sum, roll) => sum + roll, 0) + mod + modifier;

    const result: DiceRollResult = {
      total,
      rolls,
      modifier: mod + modifier,
      advantage,
      disadvantage,
      timestamp: new Date(),
    };

    setLastRoll(result);
    onRoll?.(result);
    setIsRolling(false);
  };

  const getResultColor = () => {
    if (!lastRoll) return '';

    // Highlight nat 1s and nat 20s for d20 rolls
    const { sides } = parseDiceString(dice);
    if (sides === 20 && lastRoll.rolls.length === 1) {
      if (lastRoll.rolls[0] === 20) return 'text-green-600 font-bold';
      if (lastRoll.rolls[0] === 1) return 'text-red-600 font-bold';
    }

    return '';
  };

  const baseContent = (
    <TooltipProvider>
      <div className={cn('flex items-center gap-2', className)}>
        {displayOnly ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-1 px-2 py-1 border border-border rounded-sm bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring ring-offset-background cursor-help"
                aria-label={label ? `Dice: ${label}` : `Dice: ${dice}`}
                tabIndex={0}
              >
                <Dice6 className="w-3 h-3" aria-hidden="true" />
                <span className="text-xs font-medium">{label || dice}</span>
                {modifier !== 0 && (
                  <span className="text-xs">
                    {modifier > 0 ? '+' : ''}
                    {modifier}
                  </span>
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>{label || dice}</p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={performRoll}
                disabled={disabled || isRolling}
                className="flex items-center gap-1 hover:bg-primary/10"
                aria-label={label ? `Roll ${label}` : `Roll ${dice}`}
              >
                <Dice6
                  className={cn('w-3 h-3', isRolling && 'animate-spin')}
                  aria-hidden="true"
                />
                {label || dice}
                {modifier !== 0 && (
                  <span className="text-xs">
                    {modifier > 0 ? '+' : ''}
                    {modifier}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{label ? `Roll ${label}` : `Roll ${dice}`}</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* Advantage/Disadvantage indicators */}
        {advantage && (
          <Badge variant="secondary" className="text-xs bg-green-100 text-green-800">
            <Plus className="w-2 h-2 mr-1" aria-hidden="true" />
            ADV
          </Badge>
        )}
        {disadvantage && (
          <Badge variant="secondary" className="text-xs bg-red-100 text-red-800">
            <Minus className="w-2 h-2 mr-1" aria-hidden="true" />
            DIS
          </Badge>
        )}

        {/* Last roll result */}
        {lastRoll && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={cn(
                  'text-sm font-mono outline-none focus-visible:ring-2 focus-visible:ring-ring ring-offset-background cursor-help',
                  getResultColor(),
                )}
                aria-live="polite"
                aria-label={`Last roll total: ${lastRoll.total}`}
                tabIndex={0}
              >
                {lastRoll.total}
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Last roll result</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );

  if (displayOnly) {
    return baseContent;
  }

  return baseContent;
};

export default DiceRoller;
