import { Zap } from 'lucide-react';
import React from 'react';

import { SpellCard } from '@/components/character-creation/steps/advanced-spellcasting/SpellCard';

import type { Spell } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

interface PactMagicTabProps {
  pactMagicSpells: string[];
  maxPactSpells: number;
  availableSpells: Spell[];
  pactProgression: { pactSlots: number; pactSlotLevel: number } | null;
  handlePactSpellSelection: (id: string, checked: boolean) => void;
}

/**
 * Extracted PactMagicTab component for advanced spellcasting
 */
export const PactMagicTab: React.FC<PactMagicTabProps> = ({
  pactMagicSpells,
  maxPactSpells,
  availableSpells,
  pactProgression,
  handlePactSpellSelection,
}) => (
  <TabsContent value="pact">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-purple-500" />
          Pact Magic
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Choose {maxPactSpells} spells known. Your pact magic slots recharge on short rests.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{pactProgression?.pactSlots || 0}</div>
            <div className="text-xs text-muted-foreground">Pact Magic Slots</div>
          </div>
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{pactProgression?.pactSlotLevel || 1}</div>
            <div className="text-xs text-muted-foreground">Slot Level</div>
          </div>
          <div className="text-center p-3 border rounded">
            <div className="text-2xl font-bold">{maxPactSpells}</div>
            <div className="text-xs text-muted-foreground">Spells Known</div>
          </div>
        </div>

        <div className="mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Spells Known</span>
            <Badge variant="outline">
              {pactMagicSpells.length} / {maxPactSpells}
            </Badge>
          </div>
          <div className="w-full bg-secondary rounded-full h-2 mt-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${(pactMagicSpells.length / maxPactSpells) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {availableSpells
            .filter((spell: Spell) => spell.level <= (pactProgression?.pactSlotLevel || 1))
            .map((spell: Spell) => (
              <SpellCard
                key={spell.id}
                spell={spell}
                isSelected={pactMagicSpells.includes(spell.id)}
                onSelectionChange={handlePactSpellSelection}
                disabled={
                  !pactMagicSpells.includes(spell.id) && pactMagicSpells.length >= maxPactSpells
                }
              />
            ))}
        </div>
      </CardContent>
    </Card>
  </TabsContent>
);
