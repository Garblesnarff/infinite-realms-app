import { Clock, Scroll } from 'lucide-react';
import React from 'react';

import type { Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

interface RitualTabProps {
  characterClassId: string | undefined;
  availableRitualSpells: Spell[];
}

/**
 * Extracted RitualTab component for advanced spellcasting
 */
export const RitualTab: React.FC<RitualTabProps> = ({
  characterClassId,
  availableRitualSpells,
}) => (
  <TabsContent value="ritual">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-500" />
          Ritual Casting
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          You can cast spells with the ritual tag as rituals, taking an extra 10 minutes but not
          expending a spell slot.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="flex items-center gap-2">
            <Scroll className="w-4 h-4" />
            <span className="text-sm font-medium">Available Ritual Spells</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {characterClassId === 'wizard'
              ? 'You can cast any ritual spell in your spellbook without preparing it.'
              : 'You can cast ritual spells you have prepared without expending spell slots.'}
          </p>
        </div>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {availableRitualSpells.map((spell: Spell) => (
            <div key={spell.id} className="p-3 border rounded-lg">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium">{spell.name}</span>
                    <Badge variant="outline" className="text-xs">
                      Level {spell.level}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      Ritual
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">
                    {spell.school} • {spell.castingTime} (+10 min as ritual) • {spell.range}
                  </p>
                  <p className="text-sm">{spell.description}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  </TabsContent>
);
