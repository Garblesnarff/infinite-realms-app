/* eslint-disable max-lines */
/**
 * Dice Roll Request Component
 * Displays when the DM requests a dice roll from the player
 */

import { Dice6, Zap, ArrowUp, ArrowDown, Target, AlertCircle, Info } from 'lucide-react';
import React, { useId } from 'react';

import type { RollRequest } from '@/types/roll-request';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DiceRollEmbed } from '@/features/game-session/components';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import { cn } from '@/lib/utils';

export type { RollRequest } from '@/types/roll-request';

interface DiceRollRequestProps {
  request: RollRequest;
  onRoll: (formula: string, advantage?: boolean, disadvantage?: boolean) => void;
  onManualResult: (result: number) => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * ⚡ Bolt: Static roll type configuration moved outside the component to avoid
 * re-allocation and redundant logic execution on every render.
 */
const ROLL_TYPE_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  attack: {
    color: 'border-red-200 bg-red-50',
    icon: <Target className="w-4 h-4" />,
    label: 'Attack Roll',
  },
  save: {
    color: 'border-orange-200 bg-orange-50',
    icon: <AlertCircle className="w-4 h-4" />,
    label: 'Saving Throw',
  },
  check: {
    color: 'border-blue-200 bg-blue-50',
    icon: <Dice6 className="w-4 h-4" />,
    label: 'Ability Check',
  },
  skill_check: {
    color: 'border-blue-200 bg-blue-50',
    icon: <Dice6 className="w-4 h-4" />,
    label: 'Skill Check',
  },
  damage: {
    color: 'border-purple-200 bg-purple-50',
    icon: <Dice6 className="w-4 h-4" />,
    label: 'Damage Roll',
  },
  damage_taken: {
    color: 'border-red-300 bg-red-100',
    icon: <AlertCircle className="w-4 h-4 text-red-600" />,
    label: 'Incoming Damage',
  },
  initiative: {
    color: 'border-green-200 bg-green-50',
    icon: <Zap className="w-4 h-4" />,
    label: 'Initiative',
  },
};

const DEFAULT_TYPE_CONFIG = {
  color: 'border-gray-200 bg-gray-50',
  icon: <Dice6 className="w-4 h-4" />,
  label: 'Dice Roll',
};

/**
 * Interactive Dice Roll Request Component
 * Shows when DM requests a roll, allows player to roll or input manually
 */
export const DiceRollRequest: React.FC<DiceRollRequestProps> = React.memo(
  ({ request, onRoll: _onRoll, onManualResult, onCancel, className }) => {
    const manualInputId = useId();
    const {
      manualMode,
      setManualMode,
      manualResult,
      setManualResult,
      hasAdvantage,
      hasDisadvantage,
      showDiceAnimation,
      isRolling,
      character,
      rollCalculation,
      resolvedFormula,
      effectiveManualMode,
      handleAutoRoll,
      handleDiceRollComplete,
      handleManualSubmit,
      toggleAdvantage,
      toggleDisadvantage,
    } = useDiceRollRequest({ request, onManualResult });

    const config = ROLL_TYPE_CONFIG[request.type] || DEFAULT_TYPE_CONFIG;

    return (
      <Card
        className={cn('w-full max-w-md mx-auto border-2 shadow-lg', config.color, className)}
      >
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              {config.icon}
              <span className="font-semibold text-slate-700">{config.label} Requested</span>
            </div>
          </div>

          {/* Purpose */}
          <div className="mb-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              <strong>Purpose:</strong> {request.purpose}
            </p>
          </div>

          {/* Roll Details */}
          <div className="bg-white rounded-lg p-3 mb-4 border">
            <div className="flex items-center justify-between mb-2">
              <div className="text-lg font-mono font-bold text-slate-800">
                {rollCalculation.formula}
              </div>
              {(request.dc || request.ac) && (
                <Badge variant="outline" className="text-sm">
                  {request.dc ? `DC ${request.dc}` : `AC ${request.ac}`}
                </Badge>
              )}
            </div>

            {/* Modifier Breakdown */}
            {rollCalculation.breakdown.length > 1 && (
              <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                <Info className="w-3 h-3" />
                <span>{rollCalculation.breakdown.join(' + ')}</span>
                {rollCalculation.isProficient && (
                  <Badge variant="secondary" className="text-xs px-1 py-0">
                    Proficient
                  </Badge>
                )}
              </div>
            )}

            {/* Advantage/Disadvantage Controls */}
            {request.type !== 'damage' && (
              <TooltipProvider>
                <div className="flex gap-2 mt-3" role="group" aria-label="Roll modifiers">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={hasAdvantage ? 'default' : 'outline'}
                        size="sm"
                        onClick={toggleAdvantage}
                        aria-pressed={hasAdvantage}
                        aria-label={hasAdvantage ? 'Disable Advantage' : 'Enable Advantage'}
                        className={cn(
                          'text-xs',
                          hasAdvantage
                            ? 'bg-green-600 text-white'
                            : 'text-green-600 border-green-600 hover:bg-green-50',
                        )}
                      >
                        <ArrowUp className="w-3 h-3 mr-1" aria-hidden="true" />
                        Advantage
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{hasAdvantage ? 'Disable Advantage' : 'Enable Advantage'}</p>
                    </TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant={hasDisadvantage ? 'default' : 'outline'}
                        size="sm"
                        onClick={toggleDisadvantage}
                        aria-pressed={hasDisadvantage}
                        aria-label={hasDisadvantage ? 'Disable Disadvantage' : 'Enable Disadvantage'}
                        className={cn(
                          'text-xs',
                          hasDisadvantage
                            ? 'bg-red-600 text-white'
                            : 'text-red-600 border-red-600 hover:bg-red-50',
                        )}
                      >
                        <ArrowDown className="w-3 h-3 mr-1" aria-hidden="true" />
                        Disadvantage
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{hasDisadvantage ? 'Disable Disadvantage' : 'Enable Disadvantage'}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
            )}
          </div>

          {/* Roll Actions */}
          {!effectiveManualMode ? (
            <div className="space-y-3">
              {/* Character not yet loaded — formula cannot be resolved */}
              {!character && resolvedFormula === null ? (
                <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-400" />
                  Loading character data…
                </div>
              ) : showDiceAnimation && resolvedFormula ? (
                // Show animated dice rolling
                <div className="bg-slate-50 rounded-lg p-4 border-2 border-dashed border-slate-200">
                  <DiceRollEmbed
                    expression={resolvedFormula}
                    purpose={request.purpose}
                    onRoll={handleDiceRollComplete}
                    autoRoll={true}
                    showAnimation={true}
                    advantage={hasAdvantage && !hasDisadvantage}
                    disadvantage={hasDisadvantage && !hasAdvantage}
                  />
                </div>
              ) : (
                // Show roll dice button (resolvedFormula is always non-null here)
                <TooltipProvider>
                  <div className="space-y-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          onClick={handleAutoRoll}
                          disabled={isRolling}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
                          size="lg"
                          aria-label={`Roll ${rollCalculation.formula} for ${request.purpose}`}
                        >
                          <Dice6 className="w-4 h-4 mr-2" aria-hidden="true" />
                          {isRolling ? 'Rolling...' : 'Roll Dice'}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{`Roll ${rollCalculation.formula} for ${request.purpose}`}</p>
                      </TooltipContent>
                    </Tooltip>

                    <div className="flex gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setManualMode(true)}
                            disabled={isRolling}
                            className="flex-1 text-xs"
                            size="sm"
                            aria-label="Roll physical dice and enter result manually"
                          >
                            Enter Manually
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Roll physical dice and enter result manually</p>
                        </TooltipContent>
                      </Tooltip>

                      {onCancel && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={onCancel}
                              disabled={isRolling}
                              className="flex-1 text-xs"
                              size="sm"
                              aria-label="Dismiss roll request"
                            >
                              Cancel
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Dismiss roll request</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </TooltipProvider>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label htmlFor={manualInputId} className="text-sm text-slate-600 mb-1 block">
                  {resolvedFormula === null && !manualMode
                    ? 'Roll formula could not be resolved — enter your dice result:'
                    : 'Enter your roll result:'}
                </label>
                <Input
                  id={manualInputId}
                  type="number"
                  value={manualResult}
                  onChange={(e) => setManualResult(e.target.value)}
                  placeholder="Enter total result..."
                  className="text-center text-lg font-mono"
                  min="1"
                  max="100"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  onClick={handleManualSubmit}
                  disabled={!manualResult || isNaN(parseInt(manualResult))}
                  className="flex-1"
                >
                  Submit
                </Button>
                {/* Only show "Back to Roll" when user voluntarily entered manual mode */}
                {manualMode && resolvedFormula !== null && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setManualMode(false);
                      setManualResult('');
                    }}
                    className="flex-1"
                  >
                    Back to Roll
                  </Button>
                )}
                {onCancel && !manualMode && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onCancel}
                    className="flex-1 text-xs"
                    size="sm"
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Hint Text */}
          <p className="text-xs text-slate-500 mt-3 text-center">
            {effectiveManualMode
              ? 'Enter the total result of your dice roll'
              : "Click 'Roll Dice' to automatically roll, or 'Enter Manually' if you prefer to roll physical dice"}
          </p>
        </div>
      </Card>
    );
  },
);
