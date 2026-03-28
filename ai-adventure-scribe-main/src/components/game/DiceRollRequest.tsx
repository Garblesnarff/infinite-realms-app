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

    const getTypeColor = () => {
      switch (request.type) {
        case 'attack':
          return 'border-red-200 bg-red-50';
        case 'save':
          return 'border-orange-200 bg-orange-50';
        case 'check':
          return 'border-blue-200 bg-blue-50';
        case 'skill_check':
          return 'border-blue-200 bg-blue-50';
        case 'damage':
          return 'border-purple-200 bg-purple-50';
        case 'damage_taken':
          return 'border-red-300 bg-red-100'; // More intense red for incoming damage
        case 'initiative':
          return 'border-green-200 bg-green-50';
        default:
          return 'border-gray-200 bg-gray-50';
      }
    };

    const getTypeIcon = () => {
      switch (request.type) {
        case 'attack':
          return <Target className="w-4 h-4" />;
        case 'save':
          return <AlertCircle className="w-4 h-4" />;
        case 'initiative':
          return <Zap className="w-4 h-4" />;
        case 'damage_taken':
          return <AlertCircle className="w-4 h-4 text-red-600" />;
        default:
          return <Dice6 className="w-4 h-4" />;
      }
    };

    const getTypeLabel = () => {
      switch (request.type) {
        case 'attack':
          return 'Attack Roll';
        case 'save':
          return 'Saving Throw';
        case 'check':
          return 'Ability Check';
        case 'skill_check':
          return 'Skill Check';
        case 'damage':
          return 'Damage Roll';
        case 'damage_taken':
          return 'Incoming Damage';
        case 'initiative':
          return 'Initiative';
        default:
          return 'Dice Roll';
      }
    };

    return (
      <Card className={cn('w-full max-w-md mx-auto border-2 shadow-lg', getTypeColor(), className)}>
        <div className="p-4">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-2">
              {getTypeIcon()}
              <span className="font-semibold text-slate-700">{getTypeLabel()} Requested</span>
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
              <div className="flex gap-2 mt-3">
                <Button
                  variant={hasAdvantage ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleAdvantage}
                  aria-pressed={hasAdvantage}
                  className={cn(
                    'text-xs',
                    hasAdvantage
                      ? 'bg-green-600 text-white'
                      : 'text-green-600 border-green-600 hover:bg-green-50',
                  )}
                >
                  <ArrowUp className="w-3 h-3 mr-1" />
                  Advantage
                </Button>
                <Button
                  variant={hasDisadvantage ? 'default' : 'outline'}
                  size="sm"
                  onClick={toggleDisadvantage}
                  aria-pressed={hasDisadvantage}
                  className={cn(
                    'text-xs',
                    hasDisadvantage
                      ? 'bg-red-600 text-white'
                      : 'text-red-600 border-red-600 hover:bg-red-50',
                  )}
                >
                  <ArrowDown className="w-3 h-3 mr-1" />
                  Disadvantage
                </Button>
              </div>
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
                <>
                  <Button
                    onClick={handleAutoRoll}
                    disabled={isRolling}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    size="lg"
                  >
                    <Dice6 className="w-4 h-4 mr-2" />
                    {isRolling ? 'Rolling...' : 'Roll Dice'}
                  </Button>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setManualMode(true)}
                      disabled={isRolling}
                      className="flex-1 text-xs"
                      size="sm"
                    >
                      Enter Manually
                    </Button>
                    {onCancel && (
                      <Button
                        variant="ghost"
                        onClick={onCancel}
                        disabled={isRolling}
                        className="flex-1 text-xs"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </>
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
                  onClick={handleManualSubmit}
                  disabled={!manualResult || isNaN(parseInt(manualResult))}
                  className="flex-1"
                >
                  Submit
                </Button>
                {/* Only show "Back to Roll" when user voluntarily entered manual mode */}
                {manualMode && resolvedFormula !== null && (
                  <Button
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
                  <Button variant="ghost" onClick={onCancel} className="flex-1 text-xs" size="sm">
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
