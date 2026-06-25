/**
 * Combat Status Component
 *
 * Displays current game phase and combat status information
 * Shows turn order when in combat and pending dice rolls
 * Integrates with GameContext and CombatContext for real-time updates
 */

import {
  Sword,
  Users,
  MessageSquare,
  Search,
  Bed,
  Dice6,
  Clock,
  Shield,
  Heart,
} from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCombat } from '@/contexts/CombatContext';
import { useGame } from '@/contexts/GameContext';

interface CombatStatusProps {
  className?: string;
}

/**
 * Combat Status display component
 * Shows current game phase, combat state, and active participant info
 */
export const CombatStatus: React.FC<CombatStatusProps> = React.memo(({ className }) => {
  const { state: gameState } = useGame();
  const { state: combatState } = useCombat();

  // Get phase display info
  // ⚡ Bolt: Memoize phase info to avoid re-calculating on every render
  const phaseInfo = React.useMemo(() => {
    switch (gameState.currentPhase) {
      case 'exploration':
        return { icon: Search, label: 'Exploration', color: 'bg-blue-500' };
      case 'combat':
        return { icon: Sword, label: 'Combat', color: 'bg-red-500' };
      case 'social':
        return { icon: MessageSquare, label: 'Social', color: 'bg-green-500' };
      case 'puzzle':
        return { icon: Users, label: 'Puzzle', color: 'bg-purple-500' };
      case 'rest':
        return { icon: Bed, label: 'Rest', color: 'bg-gray-500' };
      default:
        return { icon: Search, label: 'Unknown', color: 'bg-gray-400' };
    }
  }, [gameState.currentPhase]);

  const PhaseIcon = phaseInfo.icon;

  // Get current turn info
  // ⚡ Bolt: Memoize current turn info to avoid searching participants array unnecessarily
  const currentTurn = React.useMemo(() => {
    if (!combatState.isInCombat || !combatState.activeEncounter) return null;

    const currentParticipant = combatState.activeEncounter.participants.find(
      (p) => p.id === combatState.activeEncounter?.currentTurnParticipantId,
    );

    if (!currentParticipant) return null;

    return {
      name: currentParticipant.name,
      initiative: currentParticipant.initiative?.value || 0,
      hp: currentParticipant.hitPoints,
    };
  }, [combatState.isInCombat, combatState.activeEncounter]);

  // ⚡ Bolt: Memoize pending rolls filtering
  const pendingRolls = React.useMemo(
    () => gameState.diceRollQueue.pendingRolls.filter((r) => r.status === 'pending'),
    [gameState.diceRollQueue.pendingRolls],
  );

  return (
    <TooltipProvider>
      <Card
        className={`p-3 bg-white/90 backdrop-blur-sm border-2 ${className}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="flex items-center gap-3">
          {/* Game Phase Indicator */}
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <div
                className="flex items-center gap-2 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                role="group"
                aria-label={`Current phase: ${phaseInfo.label}`}
                tabIndex={0}
              >
                <div className={`p-1.5 rounded-full ${phaseInfo.color} text-white`}>
                  <PhaseIcon className="w-4 h-4" aria-hidden="true" />
                </div>
                <Badge variant="secondary" className="text-xs font-medium">
                  {phaseInfo.label}
                </Badge>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Phase: {phaseInfo.label}</p>
            </TooltipContent>
          </Tooltip>

          {/* Combat Info */}
          {combatState.isInCombat && currentTurn && (
            <>
              <div className="h-4 w-px bg-border" aria-hidden="true" />
              <div
                className="flex items-center gap-2"
                role="group"
                aria-label={`Active turn: ${currentTurn.name}`}
              >
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <span
                      className="flex items-center outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm cursor-help"
                      tabIndex={0}
                    >
                      <Clock className="w-3 h-3 text-muted-foreground" aria-hidden="true" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Current turn</p>
                  </TooltipContent>
                </Tooltip>
                <span className="text-sm font-medium">{currentTurn.name}</span>
                <Tooltip delayDuration={300}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="outline"
                      className="text-xs cursor-help focus-visible:ring-2 focus-visible:ring-infinite-purple outline-none"
                      aria-label={`Initiative: ${currentTurn.initiative}`}
                      tabIndex={0}
                    >
                      Init {currentTurn.initiative}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Initiative: {currentTurn.initiative}</p>
                  </TooltipContent>
                </Tooltip>
                {currentTurn.hp && (
                  <Tooltip delayDuration={300}>
                    <TooltipTrigger asChild>
                      <div
                        className="flex items-center gap-1 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                        aria-label={`Health: ${currentTurn.hp.current} of ${currentTurn.hp.maximum}`}
                        tabIndex={0}
                      >
                        <Heart className="w-3 h-3 text-red-500" aria-hidden="true" />
                        <span className="text-xs">
                          {currentTurn.hp.current}/{currentTurn.hp.maximum}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Health: {currentTurn.hp.current}/{currentTurn.hp.maximum}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </>
          )}

        {/* Pending Dice Rolls */}
        {pendingRolls.length > 0 && (
          <>
            <div className="h-4 w-px bg-border" aria-hidden="true" />
            <div className="flex items-center gap-1" role="group" aria-label="Pending dice rolls">
              <Dice6 className="w-3 h-3 text-blue-500 animate-pulse" aria-hidden="true" />
              <Badge variant="secondary" className="text-xs">
                {pendingRolls.length} roll{pendingRolls.length > 1 ? 's' : ''} pending
              </Badge>
            </div>
          </>
        )}

          {/* Combat Round Counter */}
          {combatState.isInCombat && combatState.activeEncounter?.currentRound && (
            <>
              <div className="h-4 w-px bg-border" aria-hidden="true" />
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <div
                    className="flex items-center gap-1 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                    role="group"
                    aria-label={`Combat Round ${combatState.activeEncounter.currentRound}`}
                    tabIndex={0}
                  >
                    <Shield className="w-3 h-3 text-orange-500" aria-hidden="true" />
                    <span className="text-xs text-muted-foreground">
                      Round {combatState.activeEncounter.currentRound}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Combat Round {combatState.activeEncounter.currentRound}</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}
        </div>
      </Card>
    </TooltipProvider>
  );
});
