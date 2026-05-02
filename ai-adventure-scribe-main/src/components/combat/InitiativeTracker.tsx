/**
 * Initiative Tracker Component
 *
 * Displays initiative order in a tabletop D&D style.
 * Shows whose turn it is, HP status, and conditions.
 * Enhanced with drag-and-drop reordering, reroll capabilities, and group handling.
 * Designed to feel like a physical initiative tracker at the table.
 */

import { ChevronRight, Dices, Plus } from 'lucide-react';
import React from 'react';

import { ParticipantRow } from '@/components/combat/ParticipantRow';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Z_INDEX } from '@/constants/z-index';
import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useCombat } from '@/contexts/CombatContext';
import { cn } from '@/lib/utils';

// ===========================
// Main Initiative Tracker
// ===========================

interface InitiativeTrackerProps {
  className?: string;
  onAddParticipant?: () => void;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent the entire tracker from re-rendering
 * on every parent state change if the combat state itself is stable.
 */
const InitiativeTracker: React.FC<InitiativeTrackerProps> = React.memo(({
  className = '',
  onAddParticipant,
}) => {
  const { state, nextTurn, rollInitiative } = useCombat();
  const { getAssetImageUrl } = useCampaignAssetsContext();
  const { activeEncounter, isInCombat } = state;

  if (!isInCombat || !activeEncounter) {
    return (
      <Card className={cn('w-full', className)}>
        <CardHeader className="space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Dices className="w-5 h-5" aria-hidden="true" />
              <h3 className="font-semibold">Initiative Tracker</h3>
            </div>
          </div>
        </CardHeader>
        <CardContent className="py-8">
          <EmptyState
            illustration="no-sessions"
            title="No Active Combat"
            description="Start a combat encounter to see the initiative order here."
            variant="minimal"
          />
        </CardContent>
      </Card>
    );
  }

  // Calculate elapsed time (narrative)
  const elapsedSeconds = activeEncounter.roundsElapsed * 6;
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  const timeDisplay = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds} seconds`;

  return (
    <Card className={cn('flex h-full w-full flex-col', className)}>
      <CardHeader
        className="sticky top-0 space-y-3 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:backdrop-blur"
        style={{ zIndex: Z_INDEX.STICKY }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold tracking-tight">Initiative Order</h3>
            <div
              className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              <Badge variant="secondary" className="text-[0.65rem] uppercase tracking-wide">
                Round {activeEncounter.currentRound}
              </Badge>
              <span>{timeDisplay} elapsed</span>
            </div>
          </div>
          {onAddParticipant && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onAddParticipant}
              aria-label="Add participant"
              title="Add participant"
              className="h-8 w-8"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={rollInitiative}
            className="flex-1 min-w-[140px] sm:flex-none"
            title="Roll initiative for all participants"
            aria-label="Roll initiative for all participants"
          >
            <Dices className="mr-2 h-4 w-4" aria-hidden="true" />
            Roll Initiative
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={nextTurn}
            className="flex-1 min-w-[140px]"
            title="Advance to the next participant's turn"
            aria-label="Advance to the next participant's turn"
          >
            <ChevronRight className="mr-2 h-4 w-4" aria-hidden="true" />
            Next Turn
          </Button>
        </div>
      </CardHeader>

      <CardContent className="flex-1 overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          {activeEncounter.participants.length === 0 ? (
            <EmptyState
              illustration="no-characters"
              title="No Combatants"
              description="Add participants to the encounter to begin tracking initiative."
              variant="card"
              action={
                onAddParticipant && (
                  <Button onClick={onAddParticipant} variant="outline" size="sm">
                    <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                    Add Participant
                  </Button>
                )
              }
            />
          ) : (
            <div className="space-y-3">
              {activeEncounter.participants.map((participant) => (
                <ParticipantRow
                  key={participant.id}
                  participant={participant}
                  isCurrentTurn={participant.id === activeEncounter.currentTurnParticipantId}
                  roundNumber={activeEncounter.currentRound}
                  getAssetImageUrl={getAssetImageUrl}
                />
              ))}
            </div>
          )}

          <p className="pt-2 text-center text-xs text-muted-foreground">
            Each round represents roughly six seconds of combat.
          </p>
        </div>
      </CardContent>
    </Card>
  );
});

InitiativeTracker.displayName = 'InitiativeTracker';

export default InitiativeTracker;
