import { motion, AnimatePresence } from 'framer-motion';
import { Howl } from 'howler';
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Play, Volume2, AlertCircle } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback } from 'react';

import { Dice3DSection } from './Dice3DSection';
import { formatRollBreakdown } from './format-roll-breakdown';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HexagonalBadge } from '@/components/ui/hexagonal-badge';
import logger from '@/lib/logger';
import { DiceEngine, type DiceRollResult } from '@/services/dice/DiceEngine';
import { fadeInUp, cardContainer, cardItem, diceRoll, pulseSuccess } from '@/utils/animations';

interface DiceRollEmbedProps {
  expression: string;
  purpose?: string;
  onRoll?: (result: DiceRollResult) => void;
  autoRoll?: boolean;
  showAnimation?: boolean;
  advantage?: boolean;
  disadvantage?: boolean;
  /**
   * Whether this roll is an attack. Only attacks can critically hit; a natural
   * 20 on a check or save is a "Natural 20", not a "Critical Hit!" (#2343 item 9).
   */
  isAttack?: boolean;
}

// Audio for dice rolling
const createDiceSound = () =>
  new Howl({
    src: ['/sounds/dice-roll.mp3', '/sounds/dice-roll.ogg'],
    volume: 0.5,
    onloaderror: () => {
      // Fallback - use a simple beep or no sound
      logger.debug('Dice roll sound not found, playing silently');
    },
  });

// Map die icons to values
const getDiceIcon = (sides: number) => {
  switch (sides) {
    case 1:
      return Dice1;
    case 2:
      return Dice2;
    case 3:
      return Dice3;
    case 4:
      return Dice4;
    case 5:
      return Dice5;
    case 6:
      return Dice6;
    default:
      return Dice6;
  }
};

export const DiceRollEmbed: React.FC<DiceRollEmbedProps> = ({
  expression,
  purpose,
  onRoll,
  autoRoll = false,
  showAnimation = true,
  advantage = false,
  disadvantage = false,
  isAttack = false,
}) => {
  const [result, setResult] = useState<DiceRollResult | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [hasRolled, setHasRolled] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  const diceSound = useRef<Howl | null>(null);

  const handleRoll = useCallback(async () => {
    if (isRolling) return;

    setIsRolling(true);
    setHasRolled(true);
    setRollError(null);

    // Play sound effect
    if (diceSound.current) {
      try {
        diceSound.current.play();
      } catch (_error) {
        // Silently continue if sound fails to play
        logger.debug('Dice sound playback failed, continuing silently');
      }
    }

    // Add rolling animation delay
    setTimeout(
      () => {
        try {
          const rollResult = DiceEngine.roll(expression, {
            purpose,
            advantage,
            disadvantage,
          });
          setResult(rollResult);
          setIsRolling(false);

          // Show result for 2 seconds before calling callback
          setTimeout(() => {
            if (onRoll) {
              onRoll(rollResult);
            }
          }, 2000);
        } catch (err) {
          logger.error('DiceRollEmbed: failed to roll expression:', expression, err);
          setIsRolling(false);
          setHasRolled(false);
          setRollError(
            `Unable to parse dice formula "${expression}". Please enter your result manually.`,
          );
        }
      },
      showAnimation ? 1500 : 100,
    );
  }, [expression, purpose, advantage, disadvantage, onRoll, isRolling, showAnimation]);

  useEffect(() => {
    diceSound.current = createDiceSound();

    if (autoRoll && !hasRolled) {
      handleRoll();
    }

    return () => {
      if (diceSound.current) {
        diceSound.current.unload();
      }
    };
  }, [autoRoll, hasRolled, handleRoll]);

  const getCriticalityBadge = (result: DiceRollResult) => {
    if (result.critical) {
      // Only attacks critically hit; a natural 20 on a check or save is a
      // "Natural 20" (#2343 item 9).
      const label = isAttack ? 'Critical Hit!' : 'Natural 20';
      const ariaLabel = isAttack ? 'Critical Hit' : 'Natural 20';
      return (
        <HexagonalBadge
          variant="status"
          size="sm"
          pulse={true}
          className="text-xs bg-electricCyan/20 text-electricCyan border-electricCyan/40 shadow-glow-teal-md hover:shadow-glow-teal-lg font-semibold"
          aria-label={ariaLabel}
        >
          {label}
        </HexagonalBadge>
      );
    }
    if (result.naturalRoll === 1) {
      // Only attacks critically miss; a natural 1 on a check or save is a
      // "Natural 1", with no hit/miss word (#2513).
      const label = isAttack ? 'Critical Miss' : 'Natural 1';
      return (
        <Badge variant="secondary" className="text-xs" aria-label={label}>
          {label}
        </Badge>
      );
    }
    return null;
  };

  const getAdvantageIndicator = (result: DiceRollResult) => {
    if (result.advantage) {
      return (
        <Badge
          variant="default"
          className="text-xs bg-green-600"
          aria-label="Rolled with advantage"
        >
          Advantage
        </Badge>
      );
    }
    if (result.disadvantage) {
      return (
        <Badge
          variant="outline"
          className="text-xs border-red-600 text-red-600"
          aria-label="Rolled with disadvantage"
        >
          Disadvantage
        </Badge>
      );
    }
    return null;
  };

  return (
    <motion.div variants={fadeInUp} initial="hidden" animate="visible">
      <Card className="p-4 my-2 bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1" title={`Dice formula: ${expression}`}>
              <Dice6 className="w-4 h-4 text-purple-600" aria-hidden="true" />
              <span className="font-mono text-sm font-semibold text-purple-800">{expression}</span>
            </div>
            {purpose && (
              <Badge variant="outline" className="text-xs" title={`Purpose: ${purpose}`}>
                {purpose}
              </Badge>
            )}
          </div>

          {!hasRolled && (
            <Button
              onClick={handleRoll}
              disabled={isRolling}
              size="sm"
              className="flex items-center gap-1"
              aria-label={`Roll ${expression}${purpose ? ` for ${purpose}` : ''}`}
              title={`Roll ${expression}${purpose ? ` for ${purpose}` : ''}`}
            >
              <Play className="w-3 h-3" aria-hidden="true" />
              Roll
            </Button>
          )}
        </div>

        {/* Roll error — shown when DiceEngine fails (e.g. symbolic formula not resolved) */}
        {rollError && (
          <div className="flex items-center gap-2 text-xs text-red-600 mb-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            <span>{rollError}</span>
          </div>
        )}

        {/* 3D Dice Animation Section */}
        <Dice3DSection
          result={result}
          isRolling={isRolling}
          hasRolled={hasRolled}
          showAnimation={showAnimation}
        />

        {/* Results Display */}
        <AnimatePresence>
          {result && !isRolling && (
            <motion.div
              variants={cardContainer}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="space-y-2"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <motion.div
                variants={pulseSuccess}
                initial="initial"
                animate="pulse"
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="text-2xl font-bold text-purple-800"
                    aria-label={`Total result: ${result.total}`}
                  >
                    Total {result.total}
                  </span>
                  {getCriticalityBadge(result)}
                  {getAdvantageIndicator(result)}
                </div>

                <div
                  className="flex items-center gap-1 text-xs text-gray-600"
                  title={`Dice type: d${result.rolls[0]?.dice || 20}`}
                  aria-label={`Dice type: d${result.rolls[0]?.dice || 20}`}
                >
                  <Volume2 className="w-3 h-3" aria-hidden="true" />
                  <span>d{result.rolls[0]?.dice || 20}</span>
                </div>
              </motion.div>

              {/* Individual Die Results */}
              {result.rolls.length > 1 && (
                <motion.div
                  variants={cardContainer}
                  initial="hidden"
                  animate="visible"
                  className="flex flex-wrap gap-1"
                  aria-label="Individual die results"
                >
                  {result.rolls.map((roll, index) => {
                    const DiceIcon = getDiceIcon(Math.min(roll.value, 6));
                    return (
                      <motion.div
                        key={index}
                        variants={cardItem}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                          roll.critical
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                        aria-label={`Die ${index + 1}: ${roll.value}${roll.critical ? ' (Critical)' : ''}`}
                        title={`Die ${index + 1}: ${roll.value}`}
                      >
                        <DiceIcon className="w-3 h-3" aria-hidden="true" />
                        <span>{roll.value}</span>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}

              <motion.div
                variants={cardItem}
                className="text-xs text-gray-600"
                data-testid="roll-breakdown"
              >
                {/* A separator before the breakdown, so the badge's face value does
                    not run straight into it: "Natural 1 — Natural 1 + Modifier +3 = Total 4" (#2513). */}
                {`— ${formatRollBreakdown(result)}`}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isRolling && (
            <motion.div
              variants={diceRoll}
              initial="rolling"
              animate="rolling"
              exit="result"
              className="flex items-center justify-center py-4"
              role="status"
              aria-live="polite"
            >
              <div
                className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"
                aria-hidden="true"
              ></div>
              <span className="ml-2 text-sm text-purple-600">Rolling...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};
