/**
 * NPC Roll Display - "Behind the DM Screen"
 * A dramatic, mysterious popup showing auto-executed NPC dice rolls
 * Design: Dark fantasy aesthetic with aged parchment and arcane elements
 */

import React, { useEffect, useState } from 'react';
import { X, Scroll, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';
import { cn } from '@/lib/utils';

interface NPCRollDisplayProps {
  roll: AutoRollResult;
  onDismiss: () => void;
  autoDismissDelay?: number; // milliseconds, default 3000
}

export const NPCRollDisplay: React.FC<NPCRollDisplayProps> = ({
  roll,
  onDismiss,
  autoDismissDelay = 3000,
}) => {
  const [isRolling, setIsRolling] = useState(true);
  const { request, result } = roll;

  // Auto-dismiss after delay
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss();
    }, autoDismissDelay);

    // Show dice animation for 800ms
    const rollTimer = setTimeout(() => {
      setIsRolling(false);
    }, 800);

    return () => {
      clearTimeout(timer);
      clearTimeout(rollTimer);
    };
  }, [autoDismissDelay, onDismiss]);

  // Determine result status
  const getResultStatus = () => {
    if (result.critical) return 'critical';
    if (result.naturalRoll === 1) return 'fumble';

    if (request.type === 'attack' && request.ac) {
      return result.total >= request.ac ? 'hit' : 'miss';
    }

    if (request.dc) {
      return result.total >= request.dc ? 'success' : 'fail';
    }

    return 'neutral';
  };

  const status = getResultStatus();

  const statusConfig = {
    critical: {
      color: 'from-amber-600 via-yellow-500 to-amber-600',
      glow: 'shadow-[0_0_30px_rgba(251,191,36,0.6)]',
      text: 'CRITICAL HIT!',
      icon: '✨',
    },
    fumble: {
      color: 'from-slate-700 via-slate-600 to-slate-700',
      glow: 'shadow-[0_0_20px_rgba(71,85,105,0.4)]',
      text: 'Critical Fumble',
      icon: '💀',
    },
    hit: {
      color: 'from-red-800 via-red-600 to-red-800',
      glow: 'shadow-[0_0_25px_rgba(220,38,38,0.5)]',
      text: `HIT (AC ${request.ac})`,
      icon: '⚔️',
    },
    miss: {
      color: 'from-slate-600 via-slate-500 to-slate-600',
      glow: 'shadow-[0_0_15px_rgba(100,116,139,0.3)]',
      text: `MISS (AC ${request.ac})`,
      icon: '🛡️',
    },
    success: {
      color: 'from-green-800 via-green-600 to-green-800',
      glow: 'shadow-[0_0_25px_rgba(22,163,74,0.5)]',
      text: `SUCCESS (DC ${request.dc})`,
      icon: '✓',
    },
    fail: {
      color: 'from-orange-800 via-orange-600 to-orange-800',
      glow: 'shadow-[0_0_20px_rgba(234,88,12,0.4)]',
      text: `FAIL (DC ${request.dc})`,
      icon: '✗',
    },
    neutral: {
      color: 'from-purple-800 via-purple-600 to-purple-800',
      glow: 'shadow-[0_0_20px_rgba(147,51,234,0.4)]',
      text: '',
      icon: '🎲',
    },
  };

  const config = statusConfig[status];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onDismiss}
      >
        {/* Backdrop with mystical atmosphere */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          style={{
            backgroundImage: `
              radial-gradient(ellipse at top, rgba(88, 28, 135, 0.15) 0%, transparent 50%),
              radial-gradient(ellipse at bottom, rgba(30, 27, 75, 0.15) 0%, transparent 50%)
            `,
          }}
        />

        {/* Main popup container */}
        <motion.div
          initial={{ scale: 0.8, y: -50, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.8, y: 50, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-md"
        >
          {/* Decorative magical particles */}
          <div className="absolute -inset-4 opacity-30">
            {[...Array(6)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute w-1 h-1 bg-amber-400 rounded-full"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                }}
                animate={{
                  y: [0, -20, 0],
                  opacity: [0.3, 0.8, 0.3],
                  scale: [1, 1.5, 1],
                }}
                transition={{
                  duration: 2 + Math.random() * 2,
                  repeat: Infinity,
                  delay: Math.random() * 2,
                }}
              />
            ))}
          </div>

          {/* Card with aged parchment aesthetic */}
          <div
            className={cn(
              'relative overflow-hidden rounded-lg border-2 border-amber-900/50',
              'bg-gradient-to-br from-[#1a1410] via-[#2d2419] to-[#1a1410]',
              config.glow
            )}
            style={{
              boxShadow: `
                0 20px 50px rgba(0, 0, 0, 0.8),
                inset 0 1px 0 rgba(255, 255, 255, 0.05),
                inset 0 -1px 0 rgba(0, 0, 0, 0.5)
              `,
            }}
          >
            {/* Texture overlay */}
            <div
              className="absolute inset-0 opacity-20 mix-blend-overlay pointer-events-none"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)' opacity='0.3'/%3E%3C/svg%3E")`,
              }}
            />

            {/* Gradient accent line */}
            <div className={cn('h-1 w-full bg-gradient-to-r', config.color)} />

            {/* Header */}
            <div className="relative px-6 pt-5 pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Scroll className="w-5 h-5 text-amber-600" />
                  <h3
                    className="text-lg font-bold tracking-wider text-amber-100"
                    style={{
                      fontFamily: '"Cinzel Decorative", "Georgia", serif',
                      textShadow: '0 2px 10px rgba(0, 0, 0, 0.8)',
                    }}
                  >
                    BEHIND THE DM SCREEN
                  </h3>
                </div>
                <button
                  onClick={onDismiss}
                  className="p-1 rounded-full hover:bg-white/10 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4 text-amber-600/70 hover:text-amber-600" />
                </button>
              </div>
            </div>

            {/* Divider with decorative pattern */}
            <div className="px-6">
              <div className="h-px bg-gradient-to-r from-transparent via-amber-900/50 to-transparent" />
            </div>

            {/* Content */}
            <div className="px-6 py-6 space-y-4">
              {/* Actor name */}
              <div className="text-center">
                <motion.p
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="text-amber-200/80 text-sm uppercase tracking-widest"
                  style={{ fontFamily: '"Cinzel", serif' }}
                >
                  {request.actorName || 'NPC'}
                </motion.p>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                  className="text-amber-50 text-base mt-1"
                  style={{ fontFamily: '"Merriweather", serif' }}
                >
                  {request.purpose}
                </motion.p>
              </div>

              {/* Dice roll visualization */}
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.4, type: 'spring', damping: 15 }}
                className="relative"
              >
                {/* Dice container */}
                <div className="relative flex items-center justify-center py-8">
                  {/* Glow effect behind dice */}
                  <div
                    className={cn(
                      'absolute inset-0 opacity-40 blur-2xl',
                      `bg-gradient-to-r ${config.color}`
                    )}
                  />

                  {/* Dice result */}
                  <motion.div
                    animate={
                      isRolling
                        ? {
                            rotate: [0, 360, 720, 1080],
                            scale: [1, 1.1, 0.9, 1.1, 1],
                          }
                        : {}
                    }
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={cn(
                      'relative flex items-center justify-center',
                      'w-24 h-24 rounded-xl',
                      'bg-gradient-to-br from-amber-900/40 via-amber-800/30 to-amber-900/40',
                      'border-2 border-amber-700/50',
                      'shadow-[0_4px_20px_rgba(0,0,0,0.5),inset_0_2px_4px_rgba(255,255,255,0.1)]'
                    )}
                  >
                    <span
                      className="text-5xl font-bold text-amber-100"
                      style={{
                        fontFamily: '"Cinzel", serif',
                        textShadow: '0 2px 8px rgba(0, 0, 0, 0.8)',
                      }}
                    >
                      {isRolling ? '?' : result.total}
                    </span>
                  </motion.div>
                </div>

                {/* Formula and breakdown */}
                {!isRolling && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.9 }}
                    className="text-center space-y-1"
                  >
                    <p className="text-amber-300/60 text-sm font-mono">{request.formula}</p>
                    {result.naturalRoll && (
                      <p className="text-amber-400/70 text-xs">
                        Natural {result.naturalRoll}
                        {result.modifiers !== 0 &&
                          ` ${result.modifiers > 0 ? '+' : ''}${result.modifiers}`}
                      </p>
                    )}
                  </motion.div>
                )}
              </motion.div>

              {/* Result status */}
              {!isRolling && config.text && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 1, type: 'spring' }}
                  className={cn(
                    'relative px-4 py-3 rounded-lg',
                    'bg-gradient-to-r',
                    config.color,
                    'shadow-lg'
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-2xl">{config.icon}</span>
                    <span
                      className="text-white font-bold text-lg tracking-wide"
                      style={{
                        fontFamily: '"Cinzel", serif',
                        textShadow: '0 2px 8px rgba(0, 0, 0, 0.9)',
                      }}
                    >
                      {config.text}
                    </span>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Footer hint */}
            <div className="px-6 pb-4">
              <p className="text-center text-amber-900/60 text-xs italic">
                Click anywhere to dismiss
              </p>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/**
 * Queue system for displaying multiple NPC rolls sequentially
 */
export const useNPCRollQueue = () => {
  const [queue, setQueue] = useState<AutoRollResult[]>([]);
  const [currentRoll, setCurrentRoll] = useState<AutoRollResult | null>(null);

  const addRolls = (rolls: AutoRollResult[]) => {
    setQueue((prev) => [...prev, ...rolls]);
  };

  const dismissCurrent = () => {
    setCurrentRoll(null);
  };

  useEffect(() => {
    if (!currentRoll && queue.length > 0) {
      const [next, ...rest] = queue;
      setCurrentRoll(next);
      setQueue(rest);
    }
  }, [currentRoll, queue]);

  return {
    currentRoll,
    addRolls,
    dismissCurrent,
    queueLength: queue.length,
  };
};
