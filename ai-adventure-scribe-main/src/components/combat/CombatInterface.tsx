/**
 * Combat Interface Component
 *
 * Main combat UI that integrates all combat components.
 * The player view is read-only (#2257): turn order, HP and the log. Nothing in it starts an
 * action or changes state. Game-master controls (End Combat, Next Turn, damage and healing,
 * action buttons, reactions, targeting) render only when `isDM` is set, and the game screen
 * sets it only in dev builds.
 */

import { Shield, Users, X, RefreshCw } from 'lucide-react';
import React, { useId } from 'react';

import ActionPanel from './ActionPanel';
import CombatLogSection from './CombatLogSection';
import { CombatReadyCard } from './CombatReadyCard';
import EnemyCard from './EnemyCard';
import HPTracker from './HPTracker';
import InitiativeTracker from './InitiativeTracker';
import ReactionOpportunityPanel from './ReactionOpportunityPanel';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCombatActions } from '@/hooks/use-combat-actions';

interface CombatInterfaceProps {
  /** Game-master controls. Defaults to false: the player view is read-only. */
  isDM?: boolean;
  /** Engine lines for the log, latest first (the same lines the chat shows). */
  logLines?: readonly string[];
}

const CombatInterface: React.FC<CombatInterfaceProps> = ({ isDM = false, logLines = [] }) => {
  const trackerId = useId();
  const {
    state,
    activeEncounter,
    isInCombat,
    playerParticipants,
    enemyParticipants,
    isPlayersTurn,
    selectedEnemy,
    setSelectedEnemy,
    showCombatMode,
    isStartingCombat,
    actionValidation,
    reactionOpportunities,
    setReactionOpportunities,
    localShowInitiativeTracker,
    setLocalShowInitiativeTracker,
    handleStartCombat,
    handleEndCombat,
    handleCombatAction,
    handleEnemyAttack,
    addEnemy,
    handleEnhancedAttack,
    handleRacialTraitUse,
    handleClassFeature,
    handleReactionOpportunity,
    handleDeathSave,
    handleConcentrationSave: _handleConcentrationSave,
    handleTwoWeaponAttack,
    handleApplyDamage,
    handleHealing,
    nextTurn,
    rollInitiative,
    showAdvantageModal: _showAdvantageModal,
    setShowAdvantageModal: _setShowAdvantageModal,
    pendingAttack: _pendingAttack,
    setPendingAttack: _setPendingAttack,
  } = useCombatActions(isDM);

  const { showCombatLog = false } = state;

  const handleEnemyKeyDown = (enemyId: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSelectedEnemy(selectedEnemy === enemyId ? null : enemyId);
    }
  };

  // Show the pre-combat card only if combat hasn't started
  if (!isInCombat && !showCombatMode) {
    return (
      <CombatReadyCard
        isDM={isDM}
        playerParticipants={playerParticipants}
        enemyParticipants={enemyParticipants}
        isStartingCombat={isStartingCombat}
        onAddEnemy={addEnemy}
        onStartCombat={handleStartCombat}
      />
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Combat Header */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <div className="flex items-center gap-3">
              <div
                className="w-3 h-3 bg-red-500 rounded-full animate-pulse"
                role="status"
                aria-label="Combat in progress"
              ></div>
              <CardTitle className="text-xl">
                Turn order · Round {activeEncounter?.currentRound || 1}
              </CardTitle>
            </div>

            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLocalShowInitiativeTracker(!localShowInitiativeTracker)}
                    aria-label={
                      localShowInitiativeTracker
                        ? 'Hide initiative tracker'
                        : 'Show initiative tracker'
                    }
                    aria-expanded={localShowInitiativeTracker}
                    aria-controls={trackerId}
                  >
                    {localShowInitiativeTracker ? 'Hide' : 'Show'} Tracker
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{localShowInitiativeTracker ? 'Hide' : 'Show'} initiative tracker</p>
                </TooltipContent>
              </Tooltip>
              {isDM && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={handleEndCombat}
                      aria-label="End current combat encounter"
                    >
                      <X className="w-4 h-4 mr-2" aria-hidden="true" />
                      End Combat
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>End current combat encounter</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* One column: this lives in a 420 px side sheet, so viewport breakpoints would cram it */}
        <div className="grid grid-cols-1 gap-6">
          {/* Initiative Tracker */}
          {localShowInitiativeTracker && (
            <div id={trackerId}>
              <InitiativeTracker />
            </div>
          )}

          {/* Main Combat Area */}
          <div>
            <div className="space-y-6">
              {activeEncounter?.currentTurnParticipantId && (
                <ActionPanel
                  activeEncounter={activeEncounter}
                  currentParticipantId={activeEncounter.currentTurnParticipantId}
                  selectedEnemyId={selectedEnemy}
                  actionValidation={actionValidation}
                  onCombatAction={handleCombatAction}
                  onNextTurn={nextTurn}
                  onRollInitiative={rollInitiative}
                  onTwoWeaponAttack={handleTwoWeaponAttack}
                  onEnhancedAttack={handleEnhancedAttack}
                  onClassFeatureUse={handleClassFeature}
                  onRacialTraitUse={handleRacialTraitUse}
                  onDeathSave={handleDeathSave}
                  showNextTurnButton={isDM}
                  showInitiativeRoll={isDM}
                  showControls={isDM}
                  isPlayersTurn={isPlayersTurn}
                />
              )}

              {isDM && (
                <ReactionOpportunityPanel
                  opportunities={reactionOpportunities}
                  onReactionSelected={handleReactionOpportunity}
                  onOpportunityDismissed={(opportunityId) =>
                    setReactionOpportunities((prev) =>
                      prev.filter((opp) => opp.id !== opportunityId),
                    )
                  }
                />
              )}

              {/* Player Character Trackers */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    Party Status
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4">
                  {playerParticipants.map((participant) => (
                    <HPTracker
                      key={participant.id}
                      participant={participant}
                      onDamage={handleApplyDamage}
                      onHeal={handleHealing}
                      isInteractive={isDM}
                    />
                  ))}
                </CardContent>
              </Card>

              {/* Enemy Cards */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5" />
                    Enemies
                  </CardTitle>
                  {isDM && (
                    <p className="text-sm text-muted-foreground">
                      Click enemies to target them for attacks
                    </p>
                  )}
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4">
                    {enemyParticipants.map((enemy) =>
                      isDM ? (
                        <div
                          key={enemy.id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selectedEnemy === enemy.id}
                          aria-label={`Select ${enemy.name}`}
                          onKeyDown={handleEnemyKeyDown(enemy.id)}
                          className={`cursor-pointer transition-all focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none focus-visible:ring-offset-2 ${
                            selectedEnemy === enemy.id
                              ? 'ring-2 ring-red-500 ring-opacity-50'
                              : 'hover:ring-1 hover:ring-red-200'
                          }`}
                          onClick={() =>
                            setSelectedEnemy(selectedEnemy === enemy.id ? null : enemy.id)
                          }
                        >
                          <EnemyCard enemyId={enemy.id} onAttack={handleEnemyAttack} />
                        </div>
                      ) : (
                        <EnemyCard key={enemy.id} enemyId={enemy.id} />
                      ),
                    )}

                    {enemyParticipants.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Users className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                        <p>No enemies in combat</p>
                        {isDM && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={addEnemy}
                                className="mt-2"
                                aria-label="Add a new enemy to the encounter"
                              >
                                Add Enemy
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Add a new enemy to the encounter</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Combat Log: players read the engine lines the chat shows; the raw action log is GM-only */}
              {!(isDM && showCombatLog) && <CombatLogSection lines={logLines} />}
              {isDM && showCombatLog && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <RefreshCw className="w-5 h-5" />
                      Combat Log
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {activeEncounter?.actions
                        .slice(-10)
                        .reverse()
                        .map((action, index) => (
                          <div key={index} className="text-sm p-2 bg-muted/50 rounded-md">
                            <div className="font-medium">{action.description}</div>

                            {action.attackRoll && (
                              <div className="text-xs text-muted-foreground space-y-1">
                                <div className="flex items-center gap-2">
                                  <span>Attack: {action.attackRoll.total}</span>
                                  {action.attackRoll.advantage && (
                                    <Badge variant="outline" className="text-green-600">
                                      Advantage
                                    </Badge>
                                  )}
                                  {action.attackRoll.disadvantage && (
                                    <Badge variant="outline" className="text-red-600">
                                      Disadvantage
                                    </Badge>
                                  )}
                                  {action.attackRoll.critical && (
                                    <Badge variant="destructive">CRITICAL!</Badge>
                                  )}
                                </div>
                                <div>
                                  Rolled: {action.attackRoll.results?.join(', ')}
                                  {action.attackRoll.modifier !== 0 &&
                                    ` + ${action.attackRoll.modifier}`}
                                </div>
                              </div>
                            )}

                            {action.damageRolls && action.damageRolls.length > 0 && (
                              <div className="text-xs text-muted-foreground">
                                Damage Rolls:{' '}
                                {action.damageRolls
                                  .map(
                                    (roll) =>
                                      `${roll.results?.join(', ')}${roll.modifier ? ` + ${roll.modifier}` : ''} = ${roll.total}`,
                                  )
                                  .join(' | ')}
                              </div>
                            )}

                            {action.damageDealt && action.damageDealt > 0 && (
                              <div className="text-xs text-destructive font-medium">
                                Total Damage: {action.damageDealt} {action.damageType}
                              </div>
                            )}

                            {action.conditionsApplied && action.conditionsApplied.length > 0 && (
                              <div className="text-xs text-blue-600">
                                Conditions: {action.conditionsApplied.map((c) => c.name).join(', ')}
                              </div>
                            )}

                            <div className="text-xs text-muted-foreground mt-1">
                              {action.timestamp
                                ? new Date(action.timestamp).toLocaleTimeString()
                                : 'Just now'}
                            </div>
                          </div>
                        ))}
                      {activeEncounter?.actions.length === 0 && (
                        <div className="text-center text-muted-foreground py-8">
                          Combat log will appear here...
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
};

export default CombatInterface;
