import React from 'react';

import type { Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import DiceRoller from '@/components/ui/dice-roller';

interface EnhancedSpellCardProps {
  spell: Spell | undefined;
  showPreparedBadge?: boolean;
  hasPactMagic: boolean;
  pactSlots: { current: number; maximum: number; level: number };
  spellSlots: Record<number, { total: number; used: number }>;
  consumePactSlot: () => void;
  consumeSpellSlot: (level: number) => void;
  isRitualDisplay?: boolean;
}

/**
 * Individual spell card for the EnhancedSpellsTab
 * Extracted for better modularity
 */
const EnhancedSpellCard: React.FC<EnhancedSpellCardProps> = ({
  spell,
  showPreparedBadge = false,
  hasPactMagic,
  pactSlots,
  spellSlots,
  consumePactSlot,
  consumeSpellSlot,
  isRitualDisplay = false,
}) => {
  if (!spell) {
    return null;
  }

  return (
    <div key={spell.id} className="p-3 border rounded-lg">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium">{spell.name}</span>
            <Badge variant="outline" className="text-xs">
              Level {spell.level}
            </Badge>
            {spell.ritual && (
              <Badge variant="secondary" className="text-xs">
                Ritual
              </Badge>
            )}
            {spell.concentration && (
              <Badge variant="secondary" className="text-xs">
                Concentration
              </Badge>
            )}
            {showPreparedBadge && (
              <Badge variant="default" className="text-xs">
                Prepared
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {spell.school} • {spell.castingTime}
            {isRitualDisplay && ' (+10 min as ritual)'} • {spell.range}
          </p>
          <p className="text-sm">{spell.description}</p>
        </div>
        <div className="flex flex-col gap-2">
          {spell.damage && <DiceRoller dice={spell.damage} label="Damage" />}
          {spell.level > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (isRitualDisplay) return; // Ritual casting doesn't consume slots in this UI
                if (hasPactMagic) {
                  consumePactSlot();
                } else {
                  consumeSpellSlot(spell.level);
                }
              }}
              disabled={
                !isRitualDisplay &&
                (hasPactMagic
                  ? pactSlots.current === 0
                  : !spellSlots[spell.level] ||
                    spellSlots[spell.level].used >= spellSlots[spell.level].total)
              }
              aria-label={isRitualDisplay ? `Cast ${spell.name} as ritual` : `Cast ${spell.name}`}
              title={isRitualDisplay ? `Cast ${spell.name} as ritual` : `Cast ${spell.name}`}
            >
              {isRitualDisplay ? 'Cast as Ritual' : 'Cast'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnhancedSpellCard;
