import { Circle } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { parseSpellSlotLevel } from '@/utils/spell-slot-level';

interface SpellSlotsSectionProps {
  spellSlots: Record<string, { total: number; used: number }>;
  longRest: () => void;
  restoreSpellSlot: (level: number) => void;
  consumeSpellSlot: (level: number) => void;
}

const SpellSlotsSection: React.FC<SpellSlotsSectionProps> = ({
  spellSlots,
  longRest,
  restoreSpellSlot,
  consumeSpellSlot,
}) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Circle className="w-5 h-5 text-infinite-purple" aria-hidden="true" />
          Spell Slots
        </CardTitle>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="sm"
              onClick={longRest}
              aria-label="Recover all spell slots and sorcery points"
            >
              Long Rest
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Recover all spell slots and sorcery points</p>
          </TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Object.entries(spellSlots).map(([level, slots]) => (
            <div key={level} className="flex items-center gap-4">
              <div className="w-16 text-sm font-medium">Level {level}</div>
              <div className="flex-1">
                <div className="flex gap-1 mb-1">
                  {Array.from({ length: slots.total }).map((_, i) => {
                    const isUsed = i < slots.used;
                    return (
                      <Tooltip key={i}>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className={`w-6 h-6 rounded border-2 transition-all focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:ring-offset-2 outline-none ${
                              isUsed
                                ? 'bg-muted border-border'
                                : 'bg-infinite-purple border-infinite-purple'
                            }`}
                            onClick={() => {
                              const spellSlotLevel = parseSpellSlotLevel(level);
                              if (spellSlotLevel === null) return;

                              if (isUsed) restoreSpellSlot(spellSlotLevel);
                              else consumeSpellSlot(spellSlotLevel);
                            }}
                            aria-label={`Level ${level} spell slot ${
                              isUsed ? 'expended' : 'available'
                            }`}
                            aria-pressed={!isUsed}
                          >
                            <span className="sr-only">
                              {isUsed ? 'Restore spell slot' : 'Consume spell slot'}
                            </span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{isUsed ? 'Restore spell slot' : 'Consume spell slot'}</p>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
                <div className="text-xs text-muted-foreground">
                  {slots.total - slots.used} / {slots.total} remaining
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default SpellSlotsSection;
