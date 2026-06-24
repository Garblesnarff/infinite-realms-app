/**
 * Combat Interface Component
 *
 * Main combat UI that integrates all combat components.
 * Shows initiative tracker, enemy cards, and combat controls.
 * Manages combat mode and participant selection.
 */

import { Sword, Shield, Users, X, Play, RefreshCw } from 'lucide-react';
import React, { useId } from 'react';

import ActionPanel from './ActionPanel';
import EnemyCard from './EnemyCard';
import HPTracker from './HPTracker';
import InitiativeTracker from './InitiativeTracker';
import ReactionOpportunityPanel from './ReactionOpportunityPanel';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCombatActions } from '@/hooks/use-combat-actions';

interface CombatInterfaceProps {
  isDM?: boolean;
}

const CombatInterface: React.FC<CombatInterfaceProps> = ({ isDM = false }) => {
  const trackerId = useId();
  const {
    state,
    activeEncounter,
    isInCombat,
    playerParticipants,
    enemyParticipants,
    playerCharacterId,
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
      <TooltipProvider>
        <Card className="w-full max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sword className="w-5 h-5" aria-hidden="true" />
              Combat Ready
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center py-8">
              <div className="text-muted-foreground mb-4">
                Prepare for battle! Your party is ready to engage enemies.
              </div>

              {playerParticipants.length === 0 ? (
                <div className="text-destructive mb-4">
                  No player characters found. Please ensure your character is selected.
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  <p className="text-sm text-muted-foreground">
                    Party: {playerParticipants.map((p) => p.name).join(', ')}
                  </p>
                  {enemyParticipants.length > 0 && (
                    <p className="text-sm text-destructive">
                      Enemies: {enemyParticipants.map((p) => p.name).join(', ')}
                    </p>
                  )}
                </div>
              )}

              <div className="flex gap-2 justify-center">
                {isDM ? (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={addEnemy}
                          variant="outline"
                          size="sm"
                          aria-label="Add a new enemy to the encounter"
                        >
                          <Users className="w-4 h-4 mr-2" aria-hidden="true" />
                          Add Enemy
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Add a new enemy to the encounter</p>
                      </TooltipContent>
                    </Tooltip>

                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={handleStartCombat}
                          disabled={isStartingCombat || playerParticipants.length === 0}
                          aria-label="Begin the combat encounter"
                        >
                          {isStartingCombat ? (
                            <>
                              <RefreshCw className="w-4 h-4 mr-2 animate-spin" aria-hidden="true" />
                              Starting...
                            </>
                          ) : (
                            <>
                              <Play className="w-4 h-4 mr-2" aria-hidden="true" />
                              Begin Combat
                            </>
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Roll initiative and start the encounter</p>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <div className="text-sm text-muted-foreground">
                    The DM will begin combat when ready.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Combat Header */}
        <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <div
              className="w-3 h-3 bg-red-500 rounded-full animate-pulse"
              role="status"
              aria-label="Combat in progress"
            ></div>
            <CardTitle className="text-xl">COMBAT IN PROGRESS</CardTitle>
            <Badge variant="destructive" className="text-sm">
              Round {activeEncounter?.currentRound || 1}
            </Badge>
          </div>

          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLocalShowInitiativeTracker(!localShowInitiativeTracker)}
                  aria-label={localShowInitiativeTracker ? 'Hide initiative tracker' : 'Show initiative tracker'}
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

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Initiative Tracker */}
        {localShowInitiativeTracker && (
          <div className="lg:col-span-1" id={trackerId}>
            <InitiativeTracker />
          </div>
        )}

        {/* Main Combat Area */}
        <div className={`lg:col-span-${localShowInitiativeTracker ? '3' : '4'}`}>
          <div className="space-y-6">
            {activeEncounter?.currentTurnParticipantId && (isDM || isPlayersTurn) && (
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
              />
            )}

            <ReactionOpportunityPanel
              opportunities={reactionOpportunities}
              onReactionSelected={handleReactionOpportunity}
              onOpportunityDismissed={(opportunityId) =>
                setReactionOpportunities((prev) => prev.filter((opp) => opp.id !== opportunityId))
              }
            />

            {/* Player Character Trackers */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="w-5 h-5" />
                  Party Status
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {playerParticipants.map((participant) => (
                  <HPTracker
                    key={participant.id}
                    participant={participant}
                    onDamage={handleApplyDamage}
                    onHeal={handleHealing}
                    isInteractive={Boolean(
                      isDM ||
                      (participant.characterId && participant.characterId === playerCharacterId),
                    )}
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
                <p className="text-sm text-muted-foreground">
                  Click enemies to target them for attacks
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {enemyParticipants.map((enemy) => (
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
                      onClick={() => setSelectedEnemy(selectedEnemy === enemy.id ? null : enemy.id)}
                    >
                      <EnemyCard
                        enemyId={enemy.id}
                        onAttack={isDM ? handleEnemyAttack : undefined}
                      />
                    </div>
                  ))}

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

            {/* Combat Log */}
            {showCombatLog && (
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
