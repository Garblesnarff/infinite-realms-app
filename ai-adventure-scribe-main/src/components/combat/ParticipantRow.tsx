import { Sword, Shield, Heart, Clock, UserX, Skull, ChevronRight } from 'lucide-react';
import React from 'react';

import type { CombatParticipant, ConditionName } from '@/types/combat';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getEnemyHealthTier, getPlayerHPBarColor } from '@/utils/hp-utils';

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

export interface ParticipantRowProps {
  participant: CombatParticipant;
  isCurrentTurn: boolean;
  roundNumber: number;
  getAssetImageUrl?: (type: string, key: string) => string | null;
}

/**
 * ⚡ Bolt: Wrapped in React.memo to prevent expensive list re-renders when
 * individual participant status (like HP or conditions) remains the same.
 */
export const ParticipantRow: React.FC<ParticipantRowProps> = React.memo(
  ({ participant, isCurrentTurn, roundNumber: _roundNumber, getAssetImageUrl }) => {
    const hpPercent =
      participant.maxHitPoints > 0
        ? (participant.currentHitPoints / participant.maxHitPoints) * 100
        : 0;
    const isDead = participant.currentHitPoints === 0 && participant.deathSaves.failures >= 3;
    const _isUnconscious =
      participant.currentHitPoints === 0 && participant.deathSaves.failures < 3;
    const isPlayer = participant.participantType === 'player';
    // Only a player rolls death saves; an enemy at 0 HP reads "Down" and nothing more.
    const needsDeathSave = isPlayer && participant.currentHitPoints === 0 && !isDead;

    // Look up portrait from campaign assets
    const assetKey = participant.name.toLowerCase().replace(/\s+/g, '-');
    const assetType =
      participant.participantType === 'monster' || participant.participantType === 'enemy'
        ? 'monster'
        : 'npc';
    const portraitUrl = participant.portraitUrl || getAssetImageUrl?.(assetType, assetKey);

    const getParticipantTypeIcon = (): React.ReactNode => {
      let icon = null;
      let label = '';

      switch (participant.participantType) {
        case 'player':
          icon = <Shield className="w-4 h-4 text-blue-500" aria-label="Player" />;
          label = 'Player';
          break;
        case 'npc':
          icon = <Heart className="w-4 h-4 text-green-500" aria-label="NPC" />;
          label = 'NPC';
          break;
        case 'enemy':
          icon = <Sword className="w-4 h-4 text-red-500" aria-label="Enemy" />;
          label = 'Enemy';
          break;
        case 'monster':
          icon = <Sword className="w-4 h-4 text-red-500" aria-label="Monster" />;
          label = 'Monster';
          break;
        default:
          icon = <UserX className="w-4 h-4 text-gray-500" aria-label="Unknown" />;
          label = 'Unknown';
      }

      return (
        <Tooltip>
          <TooltipTrigger asChild>{icon}</TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      );
    };

    // The row only reports state: nothing here is clickable (#2257). The current turn is the
    // gold-tinted row; text stays `text-foreground`, so it reads on the dark game theme.
    const rowClasses = cn(
      'flex items-center justify-between rounded-lg border p-3 shadow-sm text-foreground',
      isCurrentTurn
        ? 'border-transparent bg-infinite-gold/10 outline outline-1 outline-infinite-gold/45'
        : 'border-border bg-card',
      isDead && 'opacity-60 grayscale',
    );

    return (
      <div
        className={rowClasses}
        data-testid="participant-row"
        aria-current={isCurrentTurn ? 'true' : undefined}
      >
        {/* Turn Indicator & Initiative */}
        <div className="flex items-center space-x-3">
          {isCurrentTurn && (
            <ChevronRight
              className="w-5 h-5 text-infinite-gold animate-pulse"
              role="status"
              aria-live="polite"
              aria-label="Current turn indicator"
            />
          )}

          <div
            className="flex flex-col items-center"
            aria-label={`Initiative: ${participant.initiative}`}
          >
            <div className="text-lg font-bold text-foreground min-w-[2rem] text-center">
              {participant.initiative}
            </div>
            <div className="text-xs text-muted-foreground">init</div>
          </div>

          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground overflow-hidden">
            {portraitUrl ? (
              <img
                src={portraitUrl}
                alt={participant.name}
                className="w-full h-full object-cover"
              />
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
              className="h-1.5 flex-1 rounded-sm bg-muted"
              indicatorClassName={getPlayerHPBarColor(hpPercent)}
              aria-label={
                isPlayer
                  ? `${participant.name} Health: ${participant.currentHitPoints}/${participant.maxHitPoints}${participant.temporaryHitPoints > 0 ? ` (+${participant.temporaryHitPoints} temp)` : ''}`
                  : `${participant.name} Health bar`
              }
            />
            {isPlayer ? (
              <span className="min-w-[4rem] text-right text-sm font-medium">
                {participant.currentHitPoints}/{participant.maxHitPoints}
                {participant.temporaryHitPoints > 0 && (
                  <span className="text-blue-500">+{participant.temporaryHitPoints}</span>
                )}
              </span>
            ) : (
              <span className="min-w-[4rem] text-right text-sm font-medium">
                {getEnemyHealthTier(participant.currentHitPoints, participant.maxHitPoints)}
              </span>
            )}
          </div>

          {/* Death Saves */}
          {needsDeathSave && (
            <div
              className="flex items-center space-x-1 mt-1"
              aria-label={`Death saves: ${participant.deathSaves.successes} successes, ${participant.deathSaves.failures} failures`}
            >
              <span className="text-xs text-red-400 font-medium" aria-hidden="true">
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
            className="flex items-center gap-1 whitespace-nowrap text-sm font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm cursor-help"
            aria-label={`Armor Class: ${participant.armorClass}`}
            tabIndex={0}
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
                  <Tooltip key={index}>
                    <TooltipTrigger asChild>
                      <div
                        className={`rounded-full p-1 text-white ${colorClass} outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple cursor-help`}
                        aria-label={conditionLabel}
                        role="img"
                        tabIndex={0}
                      >
                        <ConditionIcon className="h-3 w-3" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{conditionLabel}</TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  },
);

ParticipantRow.displayName = 'ParticipantRow';
