import type { Transition } from 'framer-motion';

/**
 * Easing Functions
 * Custom easing curves for different animation types
 */
export const easing = {
  // Smooth, natural feeling - use for most UI
  ease: [0.4, 0, 0.2, 1],
  // More dramatic entrance - use for hero elements
  easeOut: [0.0, 0.0, 0.2, 1],
  // Bouncy, playful - use for success states
  easeBack: [0.34, 1.56, 0.64, 1],
  // Sharp, snappy - use for quick interactions
  easeInOut: [0.65, 0, 0.35, 1],
};

/**
 * Standard Transition Durations
 */
export const duration = {
  instant: 0.1,
  fast: 0.2,
  normal: 0.3,
  slow: 0.5,
  slower: 0.8,
};

/**
 * Spring Configurations
 * Use with motion's spring transition
 */
export const spring = {
  gentle: {
    type: 'spring',
    stiffness: 300,
    damping: 30,
  } as Transition,
  bouncy: {
    type: 'spring',
    stiffness: 400,
    damping: 20,
  } as Transition,
  stiff: {
    type: 'spring',
    stiffness: 500,
    damping: 40,
  } as Transition,
};
