import { Clock } from 'lucide-react';
import React from 'react';


import EnhancedSpellCard from '../components/EnhancedSpellCard';

import type { Spell } from '@/types/character';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface RitualCastingSectionProps {
  ritualSpells: Spell[];
  hasPactMagic: boolean;
  pactSlots: { current: number; maximum: number; level: number };
  spellSlots: Record<string, { total: number; used: number }>;
  consumePactSlot: () => void;
  consumeSpellSlot: (level: number) => void;
}

const RitualCastingSection: React.FC<RitualCastingSectionProps> = ({
  ritualSpells,
  hasPactMagic,
  pactSlots,
  spellSlots,
  consumePactSlot,
  consumeSpellSlot,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-500" aria-hidden="true" />
          Ritual Spells
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Cast these spells as rituals (extra 10 minutes, no spell slot required)
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {ritualSpells.map((spell: Spell) => (
            <EnhancedSpellCard
              key={spell.id}
              spell={spell}
              hasPactMagic={hasPactMagic}
              pactSlots={pactSlots}
              spellSlots={spellSlots}
              consumePactSlot={consumePactSlot}
              consumeSpellSlot={consumeSpellSlot}
              isRitualDisplay={true}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default RitualCastingSection;
