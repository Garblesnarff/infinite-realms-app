import { CheckCircle2, Circle } from 'lucide-react';
import React from 'react';

import { ABILITY_OPTIONS } from './variant-human-options';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { TabsContent } from '@/components/ui/tabs';
import { type AbilityScoreName } from '@/utils/racialAbilityBonuses';

interface VariantHumanAbilityTabProps {
  selectedAbilities: AbilityScoreName[];
  onToggleAbility: (ability: AbilityScoreName) => void;
}

export const VariantHumanAbilityTab: React.FC<VariantHumanAbilityTabProps> = ({
  selectedAbilities,
  onToggleAbility,
}) => {
  const isSelected = (ability: AbilityScoreName): boolean => selectedAbilities.includes(ability);

  return (
    <TabsContent value="abilities" className="space-y-4 mt-4">
      {/* Ability Choice Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {ABILITY_OPTIONS.map((ability) => {
          const selected = isSelected(ability.name);
          const disabled = !selected && selectedAbilities.length >= 2;

          return (
            <Card
              key={ability.name}
              className={`p-4 cursor-pointer transition-all duration-200 ${
                selected
                  ? 'border-infinite-gold bg-infinite-gold/10'
                  : disabled
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:border-infinite-gold/40 hover:bg-secondary/10'
              }`}
              onClick={() => !disabled && onToggleAbility(ability.name)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    {selected ? (
                      <CheckCircle2 className="w-5 h-5 text-infinite-gold" />
                    ) : (
                      <Circle className="w-5 h-5 text-muted-foreground" />
                    )}
                    <h4 className="font-semibold capitalize">{ability.label}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground ml-7">{ability.description}</p>
                </div>
                {selected && (
                  <Badge
                    variant="outline"
                    className="ml-2 bg-infinite-gold/20 text-infinite-gold border-infinite-gold/40"
                  >
                    +1
                  </Badge>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Selection Status */}
      <div className="text-center text-sm text-muted-foreground">
        {selectedAbilities.length === 0 && 'Select two abilities to receive +1 bonus'}
        {selectedAbilities.length === 1 && 'Select one more ability'}
        {selectedAbilities.length === 2 && (
          <span className="text-green-600 font-medium">✓ Both abilities selected</span>
        )}
      </div>
    </TabsContent>
  );
};
