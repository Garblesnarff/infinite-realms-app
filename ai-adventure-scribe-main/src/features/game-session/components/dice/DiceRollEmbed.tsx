import { OrbitControls, Text } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { motion, AnimatePresence } from 'framer-motion';
import { Howl } from 'howler';
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6, Play, Volume2, AlertCircle } from 'lucide-react';
import React, { useState, useRef, useEffect, useCallback } from 'react';

import type * as THREE from 'three';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HexagonalBadge } from '@/components/ui/hexagonal-badge';
import logger from '@/lib/logger';
import telemetry from '@/lib/telemetry';
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
}

// Session-scoped state for 3D dice WebGL context resilience.
// We allow up to MAX_CONTEXT_LOSS_RECOVERIES recovery attempts before permanently
// degrading to 2D/text mode for the rest of the session.
let __dice3dContextLossCount = 0;
const MAX_CONTEXT_LOSS_RECOVERIES = 2;
let __dice3dDead = false;
let __dice3dWarned = false;

// Burst-loss deduplication: multiple simultaneous canvas instances losing context within
// CONTEXT_LOSS_DEBOUNCE_MS of each other are treated as one GPU-reclamation episode.
const CONTEXT_LOSS_DEBOUNCE_MS = 500;
let __lastContextLossEpisodeTime = 0;

// Recovery cooldown: wait this long after webglcontextrestored before remounting,
// giving the GPU time to stabilize before allocating a new context.
const RECOVERY_COOLDOWN_MS = 1500;

// Auto-fallback: if context is never restored within this window, permanently degrade.
const AUTO_FALLBACK_TIMEOUT_MS = 8000;

// 3D Dice Component
function Dice3D({
  value,
  isRolling,
  diceType = 20,
}: {
  value?: number;
  isRolling: boolean;
  diceType?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (isRolling && meshRef.current) {
      // Animate dice rolling
      const animate = () => {
        if (meshRef.current) {
          meshRef.current.rotation.x += 0.1;
          meshRef.current.rotation.y += 0.1;
          meshRef.current.rotation.z += 0.05;
        }
      };

      const interval = setInterval(animate, 16);
      return () => clearInterval(interval);
    }
  }, [isRolling]);

  // Different dice shapes for different die types
  const getDiceGeometry = (sides: number) => {
    switch (sides) {
      case 4:
        return <tetrahedronGeometry args={[1]} />;
      case 6:
        return <boxGeometry args={[1, 1, 1]} />;
      case 8:
        return <octahedronGeometry args={[1]} />;
      case 10:
        return <coneGeometry args={[1, 1.5, 10]} />;
      case 12:
        return <dodecahedronGeometry args={[1]} />;
      case 20:
        return <icosahedronGeometry args={[1]} />;
      default:
        return <icosahedronGeometry args={[1]} />;
    }
  };

  const getDiceColor = (sides: number) => {
    switch (sides) {
      case 4:
        return '#ff6b6b'; // Red
      case 6:
        return '#4ecdc4'; // Teal
      case 8:
        return '#45b7d1'; // Blue
      case 10:
        return '#96ceb4'; // Green
      case 12:
        return '#ffeaa7'; // Yellow
      case 20:
        return '#dda0dd'; // Purple
      default:
        return '#dda0dd';
    }
  };

  return (
    <mesh ref={meshRef} scale={isRolling ? [1.2, 1.2, 1.2] : [1, 1, 1]}>
      {getDiceGeometry(diceType)}
      <meshStandardMaterial color={getDiceColor(diceType)} roughness={0.3} metalness={0.1} />
      {value && !isRolling && (
        <Text
          position={[0, 0, 0.6]}
          fontSize={0.3}
          color="#2c3e50"
          anchorX="center"
          anchorY="middle"
        >
          {value.toString()}
        </Text>
      )}
    </mesh>
  );
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
}) => {
  const [result, setResult] = useState<DiceRollResult | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [hasRolled, setHasRolled] = useState(false);
  const [rollError, setRollError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const diceSound = useRef<Howl | null>(null);
  // Refs to track listeners across canvas remounts so we can clean them up
  const boundCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const boundOnLostRef = useRef<EventListener | null>(null);
  const boundOnRestoredRef = useRef<EventListener | null>(null);
  // Timers for recovery cooldown and auto-fallback
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const envRecord = import.meta.env as Record<string, string | undefined>;
  const disable3D = (envRecord.VITE_DISABLE_DICE_3D ?? 'false').toLowerCase() === 'true';
  const threeDEnabled = !disable3D && !__dice3dDead;

  // Handle WebGL context loss and restoration.
  // Allows up to MAX_CONTEXT_LOSS_RECOVERIES remount attempts before permanently degrading.
  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    // Remove stale listeners from the previous canvas element (if any) before attaching new ones.
    if (boundCanvasRef.current && boundOnLostRef.current) {
      boundCanvasRef.current.removeEventListener('webglcontextlost', boundOnLostRef.current);
      boundCanvasRef.current.removeEventListener(
        'webglcontextrestored',
        boundOnRestoredRef.current!,
      );
    }

    const canvas = gl.domElement as HTMLCanvasElement;

    const onLost: EventListener = (e: Event) => {
      e.preventDefault();
      setContextLost(true);

      // Burst deduplication: if another canvas instance already handled this GPU-reclamation
      // episode (within CONTEXT_LOSS_DEBOUNCE_MS), absorb silently — counter, telemetry, and
      // logs have already been recorded for this episode.
      const now = Date.now();
      const isBurstLoss = now - __lastContextLossEpisodeTime < CONTEXT_LOSS_DEBOUNCE_MS;
      if (isBurstLoss) return;

      __lastContextLossEpisodeTime = now;
      __dice3dContextLossCount++;
      telemetry.recordWebGLContextLoss(); // once per episode, not per canvas instance

      if (__dice3dContextLossCount > MAX_CONTEXT_LOSS_RECOVERIES) {
        __dice3dDead = true;
        if (!__dice3dWarned) {
          __dice3dWarned = true;
          logger.warn(
            'Dice 3D permanently disabled after repeated WebGL context losses; falling back to 2D/text for this session.',
          );
        }
      } else {
        logger.warn(
          `THREE.WebGLRenderer: Context Lost (episode #${__dice3dContextLossCount}). Attempting recovery...`,
        );

        // Auto-fallback: if context is never restored, permanently degrade after timeout.
        if (autoFallbackTimerRef.current) clearTimeout(autoFallbackTimerRef.current);
        autoFallbackTimerRef.current = setTimeout(() => {
          autoFallbackTimerRef.current = null;
          if (!__dice3dDead) {
            __dice3dDead = true;
            if (!__dice3dWarned) {
              __dice3dWarned = true;
              logger.warn(
                'Dice 3D permanently disabled: WebGL context not restored within timeout window.',
              );
            }
          }
        }, AUTO_FALLBACK_TIMEOUT_MS);
      }
    };

    const onRestored: EventListener = () => {
      if (__dice3dDead) return; // Already permanently degraded; ignore restoration.

      // Cancel the auto-fallback — context came back in time.
      if (autoFallbackTimerRef.current) {
        clearTimeout(autoFallbackTimerRef.current);
        autoFallbackTimerRef.current = null;
      }

      // Recovery cooldown: wait before remounting so the GPU can stabilize.
      // Cancel any previous pending recovery in case of rapid lost→restored→lost cycles.
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = setTimeout(() => {
        recoveryTimerRef.current = null;
        if (__dice3dDead) return; // May have been permanently degraded during the cooldown.
        logger.info('WebGL context restored; remounting 3D dice canvas.');
        setContextLost(false);
        setCanvasKey((k) => k + 1);
      }, RECOVERY_COOLDOWN_MS);
    };

    canvas.addEventListener('webglcontextlost', onLost, { passive: false });
    canvas.addEventListener('webglcontextrestored', onRestored);

    boundCanvasRef.current = canvas;
    boundOnLostRef.current = onLost;
    boundOnRestoredRef.current = onRestored;
  }, []);

  // Clean up WebGL context event listeners and pending timers when the component unmounts.
  useEffect(() => {
    return () => {
      if (boundCanvasRef.current && boundOnLostRef.current) {
        boundCanvasRef.current.removeEventListener('webglcontextlost', boundOnLostRef.current);
        boundCanvasRef.current.removeEventListener(
          'webglcontextrestored',
          boundOnRestoredRef.current!,
        );
      }
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
      if (autoFallbackTimerRef.current) {
        clearTimeout(autoFallbackTimerRef.current);
        autoFallbackTimerRef.current = null;
      }
    };
  }, []);

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
  }, [autoRoll, hasRolled]);

  const handleRoll = async () => {
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
  };

  const getCriticalityBadge = (result: DiceRollResult) => {
    if (result.critical) {
      return (
        <HexagonalBadge
          variant="status"
          size="sm"
          pulse={true}
          className="text-xs bg-electricCyan/20 text-electricCyan border-electricCyan/40 shadow-[0_0_12px_rgba(6,182,212,0.5)] hover:shadow-[0_0_20px_rgba(6,182,212,0.7)] font-semibold"
        >
          Critical Hit!
        </HexagonalBadge>
      );
    }
    if (result.naturalRoll === 1) {
      return (
        <Badge variant="secondary" className="text-xs">
          Critical Miss
        </Badge>
      );
    }
    return null;
  };

  const getAdvantageIndicator = (result: DiceRollResult) => {
    if (result.advantage) {
      return (
        <Badge variant="default" className="text-xs bg-green-600">
          Advantage
        </Badge>
      );
    }
    if (result.disadvantage) {
      return (
        <Badge variant="outline" className="text-xs border-red-600 text-red-600">
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
            <div className="flex items-center gap-1">
              <Dice6 className="w-4 h-4 text-purple-600" />
              <span className="font-mono text-sm font-semibold text-purple-800">{expression}</span>
            </div>
            {purpose && (
              <Badge variant="outline" className="text-xs">
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
            >
              <Play className="w-3 h-3" />
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

        {/* 3D Dice Animation (feature-flagged) */}
        <AnimatePresence>
          {showAnimation && threeDEnabled && hasRolled && (
            <motion.div
              variants={cardItem}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="h-24 mb-3 rounded-lg overflow-hidden border border-purple-200"
            >
              {!contextLost ? (
                <Canvas
                  key={canvasKey}
                  onCreated={handleCreated}
                  gl={{
                    powerPreference: 'high-performance',
                    antialias: true,
                    failIfMajorPerformanceCaveat: false,
                  }}
                  camera={{ position: [0, 0, 5] }}
                >
                  <ambientLight intensity={0.5} />
                  <pointLight position={[10, 10, 10]} />

                  <group position={[0, 0, 0]}>
                    {result?.rolls.map((roll, index) => (
                      <Dice3D
                        key={index}
                        value={isRolling ? undefined : roll.value}
                        isRolling={isRolling}
                        diceType={roll.dice}
                      />
                    )) || <Dice3D value={undefined} isRolling={isRolling} diceType={20} />}
                  </group>

                  <OrbitControls enableRotate={false} enableZoom={false} enablePan={false} />
                </Canvas>
              ) : (
                <div className="h-full w-full flex items-center justify-center text-xs text-gray-600 bg-gray-50">
                  3D dice disabled after graphics context loss. Using fallback.
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showAnimation && !threeDEnabled && hasRolled && (
            <motion.div
              variants={cardItem}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="h-24 mb-3 rounded-lg overflow-hidden border border-purple-200 flex items-center justify-center text-xs text-gray-600 bg-gray-50"
            >
              3D dice unavailable. Showing results without 3D animation.
            </motion.div>
          )}
        </AnimatePresence>

        {/* Results Display */}
        <AnimatePresence>
          {result && !isRolling && (
            <motion.div
              variants={cardContainer}
              initial="hidden"
              animate="visible"
              exit="hidden"
              className="space-y-2"
            >
              <motion.div
                variants={pulseSuccess}
                initial="initial"
                animate="pulse"
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-bold text-purple-800">{result.total}</span>
                  {getCriticalityBadge(result)}
                  {getAdvantageIndicator(result)}
                </div>

                <div className="flex items-center gap-1 text-xs text-gray-600">
                  <Volume2 className="w-3 h-3" />
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
                      >
                        <DiceIcon className="w-3 h-3" />
                        <span>{roll.value}</span>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}

              {/* Modifiers */}
              {result.modifiers !== 0 && (
                <motion.div variants={cardItem} className="text-xs text-gray-600">
                  Base: {(result.total || 0) - (result.modifiers || 0)}{' '}
                  {(result.modifiers || 0) >= 0 ? '+' : ''}
                  {result.modifiers || 0}
                </motion.div>
              )}

              {/* Natural Roll for d20s */}
              {result.naturalRoll && (
                <motion.div variants={cardItem} className="text-xs text-gray-600">
                  Natural {result.naturalRoll}
                </motion.div>
              )}
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
            >
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
              <span className="ml-2 text-sm text-purple-600">Rolling...</span>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
};
