/**
 * Spell Slot Panel Component
 *
 * Displays current spell slots for the active combat participant and allows selection
 * for casting. Integrates with CombatContext to show real-time slot usage.
 *
 * Dependencies:
 * - useCombat from '@/contexts/CombatContext'
 * - shadcn/ui components for UI
 *
 * Usage: Used within CombatActionPanel when 'cast_spell' is selected
 *
 * @author Cline
 */

import { Zap } from 'lucide-react';
import React from 'react';

import type { SpellSlotLevel } from '@/utils/spell-management';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCombat } from '@/contexts/CombatContext';

// ===========================
// Type Imports
// ===========================

// ===========================
// Props Interface
// ===========================
interface SpellSlotPanelProps {
  onSpellSelect: (spellName: string, level: SpellSlotLevel) => void;
  availableSpells: string[]; // Known/prepared spells for selection
  className?: string;
}

// ===========================
// Main Component
// ===========================
const SpellSlotPanel: React.FC<SpellSlotPanelProps> = ({
  onSpellSelect,
  availableSpells,
  className = '',
}) => {
  const { state } = useCombat();
  const { activeEncounter } = state;

  if (!activeEncounter) {
    return (
      <Card className={`w-full ${className}`}>
        <CardHeader>
          <CardTitle className="text-destructive">Spell Slots</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No active combat encounter</p>
        </CardContent>
      </Card>
    );
  }

  const currentParticipant = activeEncounter.participants.find(
    (p) => p.id === activeEncounter.currentTurnParticipantId,
  );

  if (!currentParticipant || !currentParticipant.spellSlots) {
    return (
      <Card className={`w-full ${className}`}>
        <CardHeader>
          <CardTitle className="text-destructive">Spell Slots</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No spellcasting character active</p>
        </CardContent>
      </Card>
    );
  }

  const { spellSlots } = currentParticipant;

  return (
    <TooltipProvider delayDuration={300}>
      <Card className={`w-full ${className}`}>
        <CardHeader>
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-destructive" />
            <CardTitle className="text-destructive">Spell Slots</CardTitle>
          </div>
          <p className="text-sm text-muted-foreground">{currentParticipant.name}'s Spell Slots</p>
        </CardHeader>

        <CardContent>
          {/* Spell Slot Levels Display */}
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => {
              const slot = spellSlots[level as SpellSlotLevel];
              const isAvailable = slot && slot.current > 0;
              const slotStatusLabel = slot
                ? `${slot.current} of ${slot.max} level ${level} slots remaining`
                : `No level ${level} slots available`;

              return (
                <div key={level} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center">
                    <span className="font-semibold">Level {level}</span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant={isAvailable ? 'default' : 'outline'}
                          className="ml-2 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                          aria-label={slotStatusLabel}
                          tabIndex={0}
                        >
                          {slot ? `${slot.current}/${slot.max}` : '0/0'}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{slotStatusLabel}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  {isAvailable && (
                    <div className="flex flex-wrap gap-2" role="group" aria-label={`Spells for level ${level}`}>
                      {availableSpells.map((spell) => {
                        const castLabel = `Cast ${spell} using a level ${level} slot`;
                        return (
                          <Tooltip key={spell}>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => onSpellSelect(spell, level as SpellSlotLevel)}
                                className="text-xs"
                                aria-label={castLabel}
                              >
                                {spell}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{castLabel}</p>
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {availableSpells.length === 0 && (
            <div className="text-center text-muted-foreground mt-4">No spells prepared for this character</div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default SpellSlotPanel;
