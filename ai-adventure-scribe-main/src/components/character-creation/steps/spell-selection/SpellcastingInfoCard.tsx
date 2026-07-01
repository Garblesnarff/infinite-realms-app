import { BookOpen, Info } from 'lucide-react';
import React from 'react';

import type { CharacterClass } from '@/types/character';
import type { getSpellcastingInfo } from '@/utils/spell-validation';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSpellValidationRules } from '@/utils/spell-validation';

interface SpellcastingInfoCardProps {
  currentClass: CharacterClass | undefined;
  spellcastingInfo: ReturnType<typeof getSpellcastingInfo> | null;
  totalRacialCantrips: number;
}

/**
 * Extracted from SpellSelection.tsx
 * Displays class-specific spellcasting information and rules
 */
const SpellcastingInfoCard: React.FC<SpellcastingInfoCardProps> = ({
  currentClass,
  spellcastingInfo,
  totalRacialCantrips,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-purple-500" />
          {currentClass?.name} Spellcasting
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(spellcastingInfo?.cantripsKnown || 0) > 0 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {(spellcastingInfo?.cantripsKnown || 0) + totalRacialCantrips}
              </div>
              <div className="text-sm text-muted-foreground">
                Cantrips Known
                {totalRacialCantrips > 0 && (
                  <span className="text-xs text-purple-500 block">
                    (+{totalRacialCantrips} racial)
                  </span>
                )}
              </div>
            </div>
          )}

          {(spellcastingInfo?.spellsKnown || 0) > 0 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {spellcastingInfo?.spellsKnown}
              </div>
              <div className="text-sm text-muted-foreground">
                {spellcastingInfo?.hasSpellbook ? 'Spells in Spellbook' : 'Spells Known'}
              </div>
            </div>
          )}

          <div className="text-center">
            <div className="text-2xl font-bold text-green-600 capitalize">
              {spellcastingInfo?.spellcastingAbility?.substring(0, 3) || 'N/A'}
            </div>
            <div className="text-sm text-muted-foreground">Spellcasting Ability</div>
          </div>
        </div>

        {/* Spellcasting Rules */}
        {currentClass && (
          <div className="mt-4 p-3 bg-blue-50 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-blue-700 space-y-1">
                {getSpellValidationRules(currentClass).map((rule, index) => (
                  <p key={index}>{rule}</p>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SpellcastingInfoCard;
