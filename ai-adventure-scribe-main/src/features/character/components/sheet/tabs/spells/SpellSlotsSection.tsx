import { Circle } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

interface SpellSlotsSectionProps {
  spellSlots: Record<string, { total: number; used: number }>;
  longRest: () => Promise<void>;
  /** Long-rest in-flight flag — the button shows progress instead of the page spinner. */
  resting: boolean;
  /** Long-rest failure message, shown inline so the tabs stay mounted. */
  restError: string | null;
}

const SpellSlotsSection: React.FC<SpellSlotsSectionProps> = ({
  spellSlots,
  longRest,
  resting,
  restError,
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
              disabled={resting}
              aria-label="Recover all spell slots and sorcery points"
            >
              {resting ? 'Resting…' : 'Long Rest'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Recover all spell slots and sorcery points</p>
          </TooltipContent>
        </Tooltip>
      </CardHeader>
      <CardContent>
        {restError && (
          <div role="alert" className="text-sm text-red-500 mb-4">
            Long rest failed: {restError}
          </div>
        )}
        <div className="space-y-3">
          {Object.entries(spellSlots).map(([level, slots]) => (
            <div key={level} className="flex items-center gap-4">
              <div className="w-16 text-sm font-medium">Level {level}</div>
              <div className="flex-1">
                <div className="flex gap-1 mb-1">
                  {Array.from({ length: slots.total }).map((_, i) => {
                    const isUsed = i < slots.used;
                    // Read-only indicator: slot usage is owned by the engine's
                    // character_spell_slots table (#2598). The grid mirrors the
                    // character record; clicking a pip used to flip local state
                    // that reverted on reload — a second store.
                    return (
                      <span
                        key={i}
                        className={`w-6 h-6 rounded border-2 ${
                          isUsed
                            ? 'bg-muted border-border'
                            : 'bg-infinite-purple border-infinite-purple'
                        }`}
                        role="img"
                        aria-label={`Level ${level} spell slot ${
                          isUsed ? 'expended' : 'available'
                        }`}
                      />
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
