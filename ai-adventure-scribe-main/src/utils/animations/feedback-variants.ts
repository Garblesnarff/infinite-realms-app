import { duration, easing } from './constants';

import type { Variants } from 'framer-motion';

/**
 * Hover Effects
 * Use for interactive elements (cards, buttons)
 */
export const hoverScale = {
  rest: {
    scale: 1,
  },
  hover: {
    scale: 1.02,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
  tap: {
    scale: 0.98,
  },
};

export const hoverLift = {
  rest: {
    y: 0,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },
  hover: {
    y: -4,
    boxShadow: '0 12px 28px rgba(0, 0, 0, 0.15)',
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
  tap: {
    y: -2,
    scale: 0.98,
  },
};

export const hoverGlow = {
  rest: {
    boxShadow: '0 0 0 rgba(124, 58, 237, 0)',
  },
  hover: {
    boxShadow: '0 0 20px rgba(124, 58, 237, 0.4)',
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
};

export const hoverGlowGold = {
  rest: {
    boxShadow: '0 0 0 rgba(245, 158, 11, 0)',
  },
  hover: {
    boxShadow: '0 0 20px rgba(245, 158, 11, 0.4)',
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
};

/**
 * Success Celebrations
 * Use for achievements, level ups, quest completions
 */
export const celebrate: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.8,
  },
  visible: {
    opacity: 1,
    scale: 1,
    transition: {
      duration: duration.slow,
      ease: easing.easeBack,
    },
  },
};

export const pulseSuccess: Variants = {
  initial: {
    scale: 1,
  },
  pulse: {
    scale: [1, 1.05, 1],
    transition: {
      duration: 0.6,
      repeat: 2,
      ease: easing.ease,
    },
  },
};

export const sparkle: Variants = {
  hidden: {
    opacity: 0,
    scale: 0,
    rotate: 0,
  },
  visible: {
    opacity: [0, 1, 0],
    scale: [0, 1, 0.5],
    rotate: [0, 180, 360],
    transition: {
      duration: 1,
      ease: easing.easeOut,
    },
  },
};

/**
 * Loading States
 * Use for loading indicators, skeletons
 */
export const pulse: Variants = {
  pulse: {
    opacity: [0.5, 1, 0.5],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

export const rotate: Variants = {
  rotate: {
    rotate: 360,
    transition: {
      duration: 1,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

export const shimmer: Variants = {
  shimmer: {
    backgroundPosition: ['200% 0', '-200% 0'],
    transition: {
      duration: 2,
      repeat: Infinity,
      ease: 'linear',
    },
  },
};

/**
 * Typing Indicator Animation
 * Use for chat typing indicators
 */
export const typingDot: Variants = {
  typing: {
    y: [0, -8, 0],
    transition: {
      duration: 0.6,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};

/**
 * Progress Bar Animation
 * Use for HP bars, XP bars, loading progress
 */
export const progressBar = (value: number): Variants => ({
  hidden: {
    width: 0,
  },
  visible: {
    width: `${value}%`,
    transition: {
      duration: duration.slow,
      ease: easing.easeOut,
    },
  },
});

/**
 * Dice Roll Animation
 * Use for dice rolling effects
 */
export const diceRoll: Variants = {
  rolling: {
    rotate: [0, 360, 720, 1080],
    scale: [1, 1.2, 1],
    transition: {
      duration: 0.8,
      ease: easing.easeOut,
    },
  },
  result: {
    scale: [1, 1.1, 1],
    transition: {
      duration: 0.3,
      ease: easing.easeBack,
    },
  },
};

/**
 * Badge Notification Animation
 * Use for notification badges, status indicators
 */
export const badgePulse: Variants = {
  pulse: {
    scale: [1, 1.2, 1],
    opacity: [1, 0.8, 1],
    transition: {
      duration: 1.5,
      repeat: Infinity,
      ease: 'easeInOut',
    },
  },
};
