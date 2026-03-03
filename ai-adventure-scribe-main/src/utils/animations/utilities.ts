import { duration, easing } from './constants';

import type { Variants } from 'framer-motion';

/**
 * Utility: Create staggered children animation
 */
export const createStagger = (staggerDelay = 0.1, delayChildren = 0): Variants => ({
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: staggerDelay,
      delayChildren,
    },
  },
});

/**
 * Utility: Create custom fade animation
 */
export const createFade = (
  direction: 'up' | 'down' | 'left' | 'right' | 'none' = 'none',
  distance = 20,
): Variants => {
  const axis = direction === 'left' || direction === 'right' ? 'x' : 'y';
  const multiplier = direction === 'up' || direction === 'left' ? -1 : 1;
  const offset = direction === 'none' ? 0 : distance * multiplier;

  return {
    hidden: {
      opacity: 0,
      [axis]: offset,
    },
    visible: {
      opacity: 1,
      [axis]: 0,
      transition: {
        duration: duration.normal,
        ease: easing.ease,
      },
    },
  };
};

/**
 * Accessibility: Respect prefers-reduced-motion
 * Wrap animations with this utility to disable them for users who prefer reduced motion
 */
export const respectReducedMotion = (variants: Variants): Variants => {
  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReducedMotion) {
    // Return simplified variants with no animation
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.01 } },
    };
  }

  return variants;
};
