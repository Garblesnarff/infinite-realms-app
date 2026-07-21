import { Zap, Crown } from 'lucide-react';
import React from 'react';

import EnhancedSpellCard from '../components/EnhancedSpellCard';

import type { Spell } from '@/types/character';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';



interface PactMagicSectionProps {
  pactSlots: { current: number; maximum: number; level: number };
  shortRest: () => void;
  consumePactSlot: () => void;
  pactMagicSpells: Spell[];
  hasPactMagic: boolean;
  spellSlots: Record<string, { total: number; used: number }>;
  consumeSpellSlot: (level: number) => void;
}

const PactMagicSection: React.FC<PactMagicSectionProps> = ({
  pactSlots,
  shortRest,
  consumePactSlot,
  pactMagicSpells,
  hasPactMagic,
  spellSlots,
  consumeSpellSlot,
}) => {
  return (
    <div className="space-y-4">
      {/* Pact Slots */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-infinite-purple" aria-hidden="true" />
            Pact Magic Slots
          </CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                size="sm"
                onClick={shortRest}
                aria-label="Recover pact magic slots"
              >
                Short Rest
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Recover pact magic slots</p>
            </TooltipContent>
          </Tooltip>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-sm font-medium">Level {pactSlots.level} Slots</div>
            <div className="flex-1">
              <div className="flex gap-1 mb-1">
                {Array.from({ length: pactSlots.maximum }).map((_, i) => {
                  const isExpended = i >= pactSlots.current;
                  return (
                    <Tooltip key={i}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className={`w-8 h-8 rounded border-2 transition-all focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:ring-offset-2 outline-none ${
                            isExpended
                              ? 'bg-muted border-border'
                              : 'bg-infinite-purple border-infinite-purple'
                          }`}
                          onClick={consumePactSlot}
                          aria-label={`Pact magic slot ${
                            isExpended ? 'expended' : 'available'
                          }`}
                          aria-pressed={!isExpended}
                        >
                          <span className="sr-only">
                            {isExpended ? 'Expended' : 'Consume pact slot'}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{isExpended ? 'Expended' : 'Consume pact slot'}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground">
                {pactSlots.current} / {pactSlots.maximum} remaining
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pact Spells */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="w-5 h-5 text-infinite-purple" aria-hidden="true" />
            Pact Magic Spells
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {pactMagicSpells.map((spell) => (
              <EnhancedSpellCard
                key={spell.id}
                spell={spell}
                hasPactMagic={hasPactMagic}
                pactSlots={pactSlots}
                spellSlots={spellSlots}
                consumePactSlot={consumePactSlot}
                consumeSpellSlot={consumeSpellSlot}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PactMagicSection;
