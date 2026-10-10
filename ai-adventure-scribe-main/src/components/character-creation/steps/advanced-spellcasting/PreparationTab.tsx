import { BookOpen } from 'lucide-react';
import React from 'react';

import type { Spell } from '@/types/character';

import { SpellCard } from '@/components/character-creation/steps/advanced-spellcasting/SpellCard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';

interface PreparationTabProps {
  preparedSpells: string[];
  maxPreparedSpells: number;
  availableSpells: Spell[];
  handleSpellPreparation: (id: string, checked: boolean) => void;
}

/**
 * Extracted PreparationTab component for advanced spellcasting
 */
export const PreparationTab: React.FC<PreparationTabProps> = ({
  preparedSpells,
  maxPreparedSpells,
  availableSpells,
  handleSpellPreparation,
}) => (
  <TabsContent value="preparation">
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-500" />
          Spell Preparation
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {/* #212 QA-043: "Choose 1 spell" not "Choose 1 spells". */}
          Choose {maxPreparedSpells} spell{maxPreparedSpells === 1 ? '' : 's'} to prepare.
          You can change your prepared spells after a long rest.
        </p>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <div className="flex justify-between items-center">
            <span className="text-sm font-medium">Spells Prepared</span>
            <Badge variant="outline">
              {preparedSpells.length} / {maxPreparedSpells}
            </Badge>
          </div>
          <div className="w-full bg-secondary rounded-full h-2 mt-2">
            <div
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${(preparedSpells.length / maxPreparedSpells) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {availableSpells.map((spell) => (
            <SpellCard
              key={spell.id}
              spell={spell}
              isSelected={preparedSpells.includes(spell.id)}
              onSelectionChange={handleSpellPreparation}
              disabled={
                !preparedSpells.includes(spell.id) && preparedSpells.length >= maxPreparedSpells
              }
            />
          ))}
        </div>
      </CardContent>
    </Card>
  </TabsContent>
);
