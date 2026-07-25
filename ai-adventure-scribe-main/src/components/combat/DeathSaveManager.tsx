import { Heart, Shield } from 'lucide-react';
import React from 'react';

import type { CombatParticipant } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DeathSaveManagerProps {
  participant: CombatParticipant;
  onDeathSave: (participantId: string) => void;
}

const DeathSaveManager: React.FC<DeathSaveManagerProps> = ({ participant, onDeathSave }) => {
  const { successes = 0, failures = 0 } = participant.deathSaves || {};

  return (
    <Card className="border-red-500 bg-red-950/20">
      <CardHeader>
        <CardTitle className="text-red-400 flex items-center justify-between">
          <span>Dying: {participant.name}</span>
          <Heart className="w-5 h-5 animate-pulse" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className="flex justify-around items-center"
          role="status"
          aria-live="polite"
          aria-label={`Death saving throws for ${participant.name}: ${successes} successes, ${failures} failures`}
        >
          <div className="text-center">
            <p className="font-bold text-lg text-green-400">{successes}</p>
            <p className="text-xs text-muted-foreground">Successes</p>
          </div>
          <div className="text-center">
            <p className="font-bold text-lg text-red-400">{failures}</p>
            <p className="text-xs text-muted-foreground">Failures</p>
          </div>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                onClick={() => onDeathSave(participant.id)}
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                aria-label={`Roll a d20 death saving throw for ${participant.name}`}
              >
                <Shield className="w-4 h-4 mr-2" />
                Roll Death Save
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Roll a d20 death saving throw</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
};

export default DeathSaveManager;
