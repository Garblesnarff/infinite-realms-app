import { Sword, Zap, Clock } from 'lucide-react';
import React from 'react';

import type { CombatParticipant } from '@/types/combat';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCombat } from '@/contexts/CombatContext';
import { getHPColor } from '@/utils/hp-utils';

/**
 * ParticipantListItem - Memoized component for individual combatants
 * ⚡ Bolt: Extracted to prevent re-rendering all participants when only one changes
 */
const ParticipantListItem = React.memo(
  ({ participant, isCurrentTurn }: { participant: CombatParticipant; isCurrentTurn: boolean }) => {
    const hpPercent = (participant.currentHitPoints / participant.maxHitPoints) * 100;
    const isPlayer = participant.participantType === 'player';

    return (
      <div
        className={`p-2 rounded-md border ${
          isCurrentTurn
            ? 'border-primary bg-primary/5'
            : isPlayer
              ? 'border-blue-200 bg-blue-50'
              : 'border-red-200 bg-red-50'
        }`}
        aria-label={`${isCurrentTurn ? 'Current Turn: ' : ''}${participant.name}`}
      >
        <div className="flex items-center justify-between text-xs">
          <span className={`font-medium ${isPlayer ? 'text-blue-800' : 'text-red-800'}`}>
            {participant.name}
          </span>
          <span className="text-muted-foreground">Init: {participant.initiative}</span>
        </div>
        <div className="space-y-1 mt-1">
          <div className="flex items-center justify-between text-xs">
            <span>
              HP: {participant.currentHitPoints}/{participant.maxHitPoints}
            </span>
            <span className="text-muted-foreground">AC: {participant.armorClass}</span>
          </div>
          <Progress
            value={hpPercent}
            className="h-1"
            indicatorClassName={getHPColor(hpPercent)}
            aria-label={`${participant.name} Health percentage`}
          />
        </div>
        {participant.conditions.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {participant.conditions.slice(0, 3).map((condition) => (
              <span key={condition.name} className="px-1 py-0.5 bg-muted text-xs rounded">
                {condition.name}
              </span>
            ))}
            {participant.conditions.length > 3 && (
              <span className="text-xs text-muted-foreground">
                +{participant.conditions.length - 3}
              </span>
            )}
          </div>
        )}
        {isCurrentTurn && (
          <div
            className="flex items-center gap-1 mt-1 text-xs text-primary"
            role="status"
            aria-live="polite"
          >
            <Zap className="w-3 h-3" />
            <span>Current Turn</span>
          </div>
        )}
      </div>
    );
  },
);

ParticipantListItem.displayName = 'ParticipantListItem';

/**
 * CombatSummary - Compact combat overview for game sidebar
 * Shows initiative order, current turn, participant HP, and recent actions
 *
 * Dependencies:
 * - CombatContext for combat state and actions
 * - ui/card, ui/button, ui/scroll-area, ui/progress for styling
 *
 * Usage: Render in combat tab; updates live during combat
 */
export const CombatSummary: React.FC = React.memo(() => {
  const { state, nextTurn, endCombat } = useCombat();
  const { activeEncounter, isInCombat } = state;

  if (!isInCombat || !activeEncounter) {
    return (
      <EmptyState
        illustration="no-sessions"
        title="No active combat"
        description="When combat starts, you'll see the initiative order and participant status here."
        variant="card"
        className="p-8"
      />
    );
  }

  const currentParticipant = activeEncounter.participants.find(
    (p) => p.id === activeEncounter.currentTurnParticipantId,
  );
  const recentActions = activeEncounter.actions.slice(-5); // Last 5 actions

  return (
    <Card className="p-4 space-y-4 h-full flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sword className="w-4 h-4 text-destructive" />
          <h3 className="font-semibold">Combat Round {activeEncounter.currentRound}</h3>
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={nextTurn}>
            Next Turn
          </Button>
          <Button size="sm" variant="destructive" onClick={endCombat}>
            End Combat
          </Button>
        </div>
      </div>

      {/* Initiative Order */}
      <ScrollArea className="flex-1 max-h-48">
        <div className="space-y-2">
          {activeEncounter.participants.map((participant) => (
            <ParticipantListItem
              key={participant.id}
              participant={participant}
              isCurrentTurn={participant.id === activeEncounter.currentTurnParticipantId}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Recent Actions */}
      {recentActions.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Recent Actions
          </h4>
          <ScrollArea className="h-20">
            <div className="space-y-1 text-xs text-muted-foreground">
              {recentActions.map((action) => (
                <div key={action.id} className="truncate">
                  {action.description}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* Turn Summary */}
      {currentParticipant && (
        <div className="pt-2 border-t text-xs text-muted-foreground">
          <div>Current: {currentParticipant.name}</div>
          <div className="text-[10px]">
            Action: {currentParticipant.actionTaken ? 'Used' : 'Available'} | Bonus:{' '}
            {currentParticipant.bonusActionTaken ? 'Used' : 'Available'} | Reaction:{' '}
            {currentParticipant.reactionTaken ? 'Used' : 'Available'}
          </div>
        </div>
      )}
    </Card>
  );
});

CombatSummary.displayName = 'CombatSummary';
