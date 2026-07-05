import { Sword, Users, Play, RefreshCw } from 'lucide-react';
import React from 'react';

import type { CombatParticipant } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CombatReadyCardProps {
  isDM: boolean;
  playerParticipants: CombatParticipant[];
  enemyParticipants: CombatParticipant[];
  isStartingCombat: boolean;
  onAddEnemy: () => void;
  onStartCombat: () => void;
}

/**
 * CombatReadyCard Component
 *
 * Extracted from CombatInterface.tsx.
 * Shows a "Combat Ready" state before the encounter has officially started.
 */
export const CombatReadyCard: React.FC<CombatReadyCardProps> = ({
  isDM,
  playerParticipants,
  enemyParticipants,
  isStartingCombat,
  onAddEnemy,
  onStartCombat,
}) => {
  return (
    <TooltipProvider>
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

            {playerParticipants.length === 0 ? (
              <div className="text-destructive mb-4">
                No player characters found. Please ensure your character is selected.
              </div>
            ) : (
              <div className="space-y-2 mb-4">
                <p className="text-sm text-muted-foreground">
                  Party: {playerParticipants.map((p) => p.name).join(', ')}
                </p>
                {enemyParticipants.length > 0 && (
                  <p className="text-sm text-destructive">
                    Enemies: {enemyParticipants.map((p) => p.name).join(', ')}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-center">
              {isDM ? (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        onClick={onAddEnemy}
                        variant="outline"
                        size="sm"
                        aria-label="Add a new enemy to the encounter"
                      >
                        <Users className="w-4 h-4 mr-2" aria-hidden="true" />
                        Add Enemy
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Add a new enemy to the encounter</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        onClick={onStartCombat}
                        disabled={isStartingCombat || playerParticipants.length === 0}
                        aria-label="Begin the combat encounter"
                      >
                        {isStartingCombat ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                            Starting...
                          </>
                        ) : (
                          <>
                            <Play className="w-4 h-4 mr-2" aria-hidden="true" />
                            Begin Combat
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Roll initiative and start the encounter</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  The DM will begin combat when ready.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};
