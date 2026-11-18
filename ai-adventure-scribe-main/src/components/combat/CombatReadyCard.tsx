import { Sword } from 'lucide-react';
import React from 'react';

import type { CombatParticipant } from '@/types/combat';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

interface CombatReadyCardProps {
  playerParticipants: CombatParticipant[];
  enemyParticipants: CombatParticipant[];
  /** The active character's name, for the pre-combat view before any encounter exists. */
  activeCharacterName?: string;
}

/**
 * CombatReadyCard Component
 *
 * Extracted from CombatInterface.tsx.
 * Shows a "Combat Ready" state before the encounter has officially started. Combat is begun by
 * the server's combat entry, so this card has no controls.
 */
export const CombatReadyCard: React.FC<CombatReadyCardProps> = ({
  playerParticipants,
  enemyParticipants,
  activeCharacterName,
}) => {
  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sword className="w-5 h-5" aria-hidden="true" />
          Combat Ready
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center py-8">
          <div className="text-muted-foreground mb-4">
            Prepare for battle! Your party is ready to engage enemies.
          </div>

          {playerParticipants.length === 0 && !activeCharacterName ? (
            <div className="text-destructive mb-4">
              No player characters found. Please ensure your character is selected.
            </div>
          ) : (
            <div className="space-y-2 mb-4">
              <p className="text-sm text-muted-foreground">
                Party:{' '}
                {playerParticipants.length > 0
                  ? playerParticipants.map((p) => p.name).join(', ')
                  : activeCharacterName}
              </p>
              {enemyParticipants.length > 0 && (
                <p className="text-sm text-destructive">
                  Enemies: {enemyParticipants.map((p) => p.name).join(', ')}
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 justify-center">
            <div className="text-sm text-muted-foreground">
              The DM will begin combat when ready.
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
