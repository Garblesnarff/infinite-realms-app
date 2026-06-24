import { Star } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AttunementSectionProps {
  character: Character;
  attunedCount: number;
  maxAttunementSlots: number;
  isAtCapacity: boolean;
}

/**
 * Displays attunement slots visualization
 */
export const AttunementSection: React.FC<AttunementSectionProps> = ({
  character,
  attunedCount,
  maxAttunementSlots,
  isAtCapacity,
}) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Star className="w-5 h-5 text-purple-500" />
          Attunement
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <span className="text-sm">Attuned Items:</span>
          <div className="flex gap-2" role="group" aria-label="Attunement slots">
            {[1, 2, 3].map((slot) => {
              const attunedItems = character.inventory?.filter((item) => item.isAttuned) || [];
              const isOccupied = slot <= attunedItems.length;

              return (
                <div
                  key={slot}
                  className={`w-8 h-8 rounded border-2 flex items-center justify-center transition-colors ${
                    isOccupied ? 'bg-purple-500 border-purple-600 text-white' : 'border-gray-300'
                  }`}
                  aria-label={`Attunement slot ${slot}: ${isOccupied ? 'Occupied' : 'Empty'}`}
                  title={`Attunement slot ${slot}: ${isOccupied ? 'Occupied' : 'Empty'}`}
                >
                  {isOccupied && <Star className="w-4 h-4" />}
                </div>
              );
            })}
          </div>
          <span className="text-xs text-muted-foreground">
            {attunedCount} / {maxAttunementSlots} slots used
          </span>
        </div>

        {isAtCapacity && (
          <div className="mt-3 text-sm text-orange-600">
            Attunement capacity reached. Remove attunement from an item to attune to a new one.
          </div>
        )}
      </CardContent>
    </Card>
  );
};
