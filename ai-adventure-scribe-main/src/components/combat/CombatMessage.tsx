import React from 'react';

import { CombatDiceResult } from './messages/CombatDiceResult';
import { getTypeIcon, getTypeColor, getBorderClass } from './messages/CombatMessageUtils';
import { CombatSummaryMessage } from './messages/CombatSummaryMessage';
import { InitiativeMessage } from './messages/InitiativeMessage';

import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { type CombatMessageData } from '@/utils/combat/ai-narration-utils';

// Re-export types and components for backward compatibility
export type { CombatMessageData };
export { InitiativeMessage, CombatSummaryMessage };

interface CombatMessageProps {
  data: CombatMessageData;
  timestamp?: string;
}

/**
 * Combat Message Component
 * Displays combat-specific dice rolls and actions in the chat
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of combat rolls
 */
export const CombatMessage: React.FC<CombatMessageProps> = React.memo(({ data, timestamp }) => {
  return (
    <Card className={`p-3 mb-2 bg-card/80 border-l-4 ${getBorderClass(data)}`}>
      <div className="flex items-start gap-3">
        {/* Icon and Type */}
        <div className={`p-2 rounded-full text-white ${getTypeColor(data)}`}>
          {getTypeIcon(data.type)}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm">{data.actor}</span>
              {data.target && (
                <>
                  <span className="text-muted-foreground">→</span>
                  <span className="text-sm">{data.target}</span>
                </>
              )}
            </div>
            {timestamp && <span className="text-xs text-muted-foreground">{timestamp}</span>}
          </div>

          {/* Action Description */}
          <div className="text-sm text-muted-foreground mb-3">{data.description}</div>

          <Separator className="my-2" />

          {/* Dice Roll Display */}
          <CombatDiceResult data={data} />

          {/* Additional Action Info */}
          {data.action && (
            <div className="mt-3 p-2 bg-muted/50 rounded text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">Action:</span>
                <span>{data.action.action}</span>
                {data.action.weapon && (
                  <>
                    <span className="text-muted-foreground">•</span>
                    <span>{data.action.weapon}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
});

CombatMessage.displayName = 'CombatMessage';
