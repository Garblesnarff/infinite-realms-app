import { Dice6 } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { type DiceRoll } from '@/utils/diceUtils';

/**
 * Initiative Roll Message Component
 * Special component for initiative rolls showing turn order
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of initiative lists
 */
interface InitiativeMessageProps {
  participants: Array<{ name: string; initiative: number; roll: DiceRoll }>;
  timestamp?: string;
}

export const InitiativeMessage: React.FC<InitiativeMessageProps> = React.memo(
  ({ participants, timestamp }) => {
    const sortedParticipants = [...participants].sort((a, b) => b.initiative - a.initiative);

    return (
      <Card className="p-4 mb-2 bg-yellow-50 border-l-4 border-l-yellow-500">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-2 rounded-full text-white bg-yellow-500">
            <Dice6 className="w-4 h-4" />
          </div>
          <span className="font-semibold">Initiative Order</span>
          {timestamp && <span className="text-xs text-muted-foreground ml-auto">{timestamp}</span>}
        </div>

        <div className="space-y-2">
          {sortedParticipants.map((participant, index) => (
            <div
              key={participant.name}
              className="flex items-center justify-between p-2 bg-white rounded"
            >
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="text-xs min-w-6 justify-center">
                  {index + 1}
                </Badge>
                <span className="font-medium">{participant.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  [{participant.roll.results.join(', ')}] {participant.roll.modifier >= 0 ? '+' : ''}
                  {participant.roll.modifier}
                </span>
                <Badge variant="secondary" className="font-mono">
                  {participant.initiative}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  },
);

InitiativeMessage.displayName = 'InitiativeMessage';
