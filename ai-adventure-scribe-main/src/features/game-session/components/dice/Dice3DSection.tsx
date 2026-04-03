import { OrbitControls, Text } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { motion, AnimatePresence } from 'framer-motion';
import React, { useState, useRef, useEffect, useCallback } from 'react';

import type { DiceRollResult } from '@/services/dice/DiceEngine';
import type * as THREE from 'three';

import logger from '@/lib/logger';
import telemetry from '@/lib/telemetry';
import { cardItem } from '@/utils/animations';

// Session-scoped state for 3D dice WebGL context resilience.
// We allow up to MAX_CONTEXT_LOSS_RECOVERIES recovery attempts before permanently
// degrading to 2D/text mode for the rest of the session.
let __dice3dContextLossCount = 0;
const MAX_CONTEXT_LOSS_RECOVERIES = 1;
let __dice3dDead = false;
let __dice3dWarned = false;

// Active canvas counter: limits simultaneous WebGL canvases to prevent GPU context
// exhaustion during multi-roll sequences (attack + damage + save, etc.).
let __activeDice3dCount = 0;
const MAX_SIMULTANEOUS_DICE_3D = 1;

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

interface Dice3DSectionProps {
  result: DiceRollResult | null;
  isRolling: boolean;
  hasRolled: boolean;
  showAnimation: boolean;
}

export const Dice3DSection: React.FC<Dice3DSectionProps> = ({
  result,
  isRolling,
  hasRolled,
  showAnimation,
}) => {
  const [contextLost, setContextLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);

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
  // canRender3D also guards against GPU context exhaustion from simultaneous canvases
  const canRender3D = threeDEnabled && __activeDice3dCount < MAX_SIMULTANEOUS_DICE_3D;

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

    // Track active canvas count to prevent GPU context exhaustion during multi-roll sequences.
    __activeDice3dCount++;
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
      __activeDice3dCount = Math.max(0, __activeDice3dCount - 1);
    };
  }, []);

  return (
    <>
      {/* 3D Dice Animation (feature-flagged) */}
      <AnimatePresence>
        {showAnimation && canRender3D && hasRolled && (
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
    </>
  );
};
