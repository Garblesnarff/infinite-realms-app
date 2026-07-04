import { Shield } from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

/**
 * Combat Summary Message Component
 * Displays end-of-combat summary with damage dealt, rounds, etc.
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of combat summaries
 * Extracted from CombatMessage.tsx
 */
export interface CombatSummaryProps {
  summary: {
    rounds: number;
    totalDamage: number;
    participants: Array<{ name: string; damageDealt: number; damageTaken: number; status: string }>;
    outcome: string;
  };
  timestamp?: string;
}

export const CombatSummaryMessage: React.FC<CombatSummaryProps> = React.memo(
  ({ summary, timestamp }) => {
    return (
      <Card className="p-4 mb-2 bg-slate-50 border-l-4 border-l-slate-500">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-2 rounded-full text-white bg-slate-500">
            <Shield className="w-4 h-4" />
          </div>
          <span className="font-semibold">Combat Summary</span>
          {timestamp && <span className="text-xs text-muted-foreground ml-auto">{timestamp}</span>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div className="space-y-2">
            <div className="text-sm">
              <strong>Outcome:</strong> {summary.outcome}
            </div>
            <div className="text-sm">
              <strong>Rounds:</strong> {summary.rounds}
            </div>
            <div className="text-sm">
              <strong>Total Damage:</strong> {summary.totalDamage}
            </div>
          </div>
        </div>

        <Separator className="my-3" />

        <div className="space-y-2">
          <h4 className="font-medium text-sm mb-2">Participant Summary:</h4>
          {summary.participants.map((participant) => (
            <div
              key={participant.name}
              className="flex items-center justify-between p-2 bg-white rounded text-xs"
            >
              <span className="font-medium">{participant.name}</span>
              <div className="flex items-center gap-4">
                <span className="text-red-600">-{participant.damageTaken} HP</span>
                <span className="text-green-600">+{participant.damageDealt} DMG</span>
                <Badge variant="outline" className="text-xs">
                  {participant.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  },
);

CombatSummaryMessage.displayName = 'CombatSummaryMessage';
