/* eslint-disable max-lines */
/**
 * Initiative Tracker Component
 *
 * Displays initiative order in a tabletop D&D style.
 * Shows whose turn it is, HP status, and conditions.
 * Enhanced with drag-and-drop reordering, reroll capabilities, and group handling.
 * Designed to feel like a physical initiative tracker at the table.
 */

import { Sword, Shield, Heart, Clock, UserX, Skull, ChevronRight, Dices, Plus } from 'lucide-react';
import React from 'react';

import type { CombatParticipant, ConditionName } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Z_INDEX } from '@/constants/z-index';
import { useCampaignAssetsContext } from '@/contexts/CampaignAssetsContext';
import { useCombat } from '@/contexts/CombatContext';
import { cn } from '@/lib/utils';
import { getHPColor } from '@/utils/hp-utils';

// ===========================
// Condition Icons & Colors
// ===========================

const CONDITION_ICONS: Record<
  ConditionName,
  { icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  blinded: { icon: UserX, color: 'bg-gray-500' },
  charmed: { icon: Heart, color: 'bg-pink-500' },
  deafened: { icon: UserX, color: 'bg-slate-500' },
  frightened: { icon: Skull, color: 'bg-yellow-500' },
  grappled: { icon: UserX, color: 'bg-orange-500' },
  incapacitated: { icon: UserX, color: 'bg-red-500' },
  invisible: { icon: UserX, color: 'bg-blue-200' },
  paralyzed: { icon: UserX, color: 'bg-purple-600' },
  petrified: { icon: UserX, color: 'bg-stone-500' },
  poisoned: { icon: UserX, color: 'bg-green-600' },
  prone: { icon: UserX, color: 'bg-brown-500' },
  restrained: { icon: UserX, color: 'bg-red-600' },
  stunned: { icon: UserX, color: 'bg-yellow-600' },
  unconscious: { icon: UserX, color: 'bg-black' },
  exhaustion: { icon: Clock, color: 'bg-gray-600' },
  surprised: { icon: Skull, color: 'bg-yellow-400' },
};

// ===========================
// Participant Row Component
// ===========================

interface ParticipantRowProps {
  participant: CombatParticipant;
  isCurrentTurn: boolean;
  roundNumber: number;
  onSelectParticipant?: (participantId: string) => void;
  getAssetImageUrl?: (type: string, key: string) => string | null;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent expensive list re-renders when
 * individual participant status (like HP or conditions) remains the same.
 */
const ParticipantRow: React.FC<ParticipantRowProps> = React.memo(({
  participant,
  isCurrentTurn,
  roundNumber: _roundNumber,
  onSelectParticipant,
  getAssetImageUrl,
}) => {
  const hpPercent =
    participant.maxHitPoints > 0
      ? (participant.currentHitPoints / participant.maxHitPoints) * 100
      : 0;
  const isDead = participant.currentHitPoints === 0 && participant.deathSaves.failures >= 3;
  const _isUnconscious = participant.currentHitPoints === 0 && participant.deathSaves.failures < 3;
  const needsDeathSave = participant.currentHitPoints === 0 && !isDead;

  // Look up portrait from campaign assets
  const assetKey = participant.name.toLowerCase().replace(/\s+/g, '-');
  const assetType =
    participant.participantType === 'monster' || participant.participantType === 'enemy'
      ? 'monster'
      : 'npc';
  const portraitUrl = participant.portraitUrl || getAssetImageUrl?.(assetType, assetKey);

  const getParticipantTypeIcon = (): React.ReactNode => {
    switch (participant.participantType) {
      case 'player':
        return <Shield className="w-4 h-4 text-blue-500" aria-label="Player" title="Player" />;
      case 'npc':
        return <Heart className="w-4 h-4 text-green-500" aria-label="NPC" title="NPC" />;
      case 'enemy':
        return <Sword className="w-4 h-4 text-red-500" aria-label="Enemy" title="Enemy" />;
      case 'monster':
        return <Sword className="w-4 h-4 text-red-500" aria-label="Monster" title="Monster" />;
      default:
        return <UserX className="w-4 h-4 text-gray-500" aria-label="Unknown" title="Unknown" />;
    }
  };

  const rowClasses = cn(
    'flex items-center justify-between rounded-lg border p-3 transition-all cursor-pointer shadow-sm focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none',
    isCurrentTurn
      ? 'border-amber-300/70 bg-amber-50 dark:bg-amber-900/30 ring-1 ring-amber-200'
      : 'border-border bg-card hover:bg-muted/60',
    isDead && 'opacity-60 grayscale',
  );

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectParticipant?.(participant.id);
    }
  };

  return (
    <div
      className={rowClasses}
      onClick={() => onSelectParticipant?.(participant.id)}
      title="Select participant to view details"
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-label={`${isCurrentTurn ? 'Current Turn: ' : ''}Select ${participant.name}`}
    >
      {/* Turn Indicator & Initiative */}
      <div className="flex items-center space-x-3">
        {isCurrentTurn && (
          <ChevronRight
            className="w-5 h-5 text-amber-600 animate-pulse"
            role="status"
            aria-live="polite"
            aria-label="Current turn indicator"
          />
        )}

        <div
          className="flex flex-col items-center"
          aria-label={`Initiative: ${participant.initiative}`}
        >
          <div className="text-lg font-bold text-gray-700 min-w-[2rem] text-center">
            {participant.initiative}
          </div>
          <div className="text-xs text-gray-500">init</div>
        </div>

        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground overflow-hidden">
          {portraitUrl ? (
            <img src={portraitUrl} alt={participant.name} className="w-full h-full object-cover" />
          ) : (
            getParticipantTypeIcon()
          )}
        </div>
      </div>

      {/* Participant Info */}
      <div className="flex-1 ml-4">
        <div className="flex items-center gap-2">
          <h4 className={`font-semibold ${isDead ? 'line-through' : ''}`}>{participant.name}</h4>

          {/* Action Status Indicators */}
          {isCurrentTurn && (
            <div className="flex flex-wrap gap-1">
              {participant.actionTaken && (
                <Badge
                  variant="secondary"
                  className="text-[0.65rem] font-medium uppercase tracking-wide bg-amber-100 text-amber-800"
                >
                  Action
                </Badge>
              )}
              {participant.bonusActionTaken && (
                <Badge
                  variant="secondary"
                  className="text-[0.65rem] font-medium uppercase tracking-wide bg-orange-100 text-orange-800"
                >
                  Bonus
                </Badge>
              )}
              {participant.reactionTaken && (
                <Badge
                  variant="secondary"
                  className="text-[0.65rem] font-medium uppercase tracking-wide bg-yellow-100 text-yellow-800"
                >
                  Reaction
                </Badge>
              )}
            </div>
          )}
        </div>

        {/* HP Bar */}
        <div className="mt-2 flex items-center gap-2">
          <Progress
            value={hpPercent}
            className="h-2 flex-1"
            indicatorClassName={getHPColor(hpPercent)}
            aria-label={`${participant.name} Health: ${participant.currentHitPoints}/${participant.maxHitPoints}${participant.temporaryHitPoints > 0 ? ` (+${participant.temporaryHitPoints} temp)` : ''}`}
          />
          <span className="min-w-[4rem] text-right text-sm font-medium">
            {participant.currentHitPoints}/{participant.maxHitPoints}
            {participant.temporaryHitPoints > 0 && (
              <span className="text-blue-500">+{participant.temporaryHitPoints}</span>
            )}
          </span>
        </div>

        {/* Death Saves */}
        {needsDeathSave && (
          <div
            className="flex items-center space-x-1 mt-1"
            aria-label={`Death saves: ${participant.deathSaves.successes} successes, ${participant.deathSaves.failures} failures`}
          >
            <span className="text-xs text-red-600 font-medium" aria-hidden="true">
              Death Saves:
            </span>
            <div className="flex space-x-1" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <div
                  key={`success-${i}`}
                  className={`w-2 h-2 rounded-full ${
                    i <= participant.deathSaves.successes ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
            <span className="text-xs mx-1" aria-hidden="true">
              /
            </span>
            <div className="flex space-x-1" aria-hidden="true">
              {[1, 2, 3].map((i) => (
                <div
                  key={`failure-${i}`}
                  className={`w-2 h-2 rounded-full ${
                    i <= participant.deathSaves.failures ? 'bg-red-500' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* AC & Conditions */}
      <div className="flex flex-col items-end gap-1 text-xs text-muted-foreground">
        <div
          className="flex items-center gap-1 text-sm font-semibold text-foreground"
          aria-label={`Armor Class: ${participant.armorClass}`}
        >
          <Shield className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span>AC {participant.armorClass}</span>
        </div>

        {/* Condition Icons */}
        {participant.conditions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {participant.conditions.map((condition, index) => {
              const ConditionIcon = CONDITION_ICONS[condition.name]?.icon || UserX;
              const colorClass = CONDITION_ICONS[condition.name]?.color || 'bg-gray-500';

              const conditionLabel = `${condition.name}${condition.duration > 0 ? ` (${condition.duration} rounds)` : ''}`;
              return (
                <div
                  key={index}
                  className={`rounded-full p-1 text-white ${colorClass}`}
                  title={conditionLabel}
                  aria-label={conditionLabel}
                  role="img"
                >
                  <ConditionIcon className="h-3 w-3" />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

ParticipantRow.displayName = 'ParticipantRow';

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
