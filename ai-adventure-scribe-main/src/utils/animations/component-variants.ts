import { duration, easing } from './constants';

import type { Variants } from 'framer-motion';

/**
 * Card Entrance Animations
 * Use for card grids, lists with staggered reveals
 */
export const cardContainer: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.05,
    },
  },
};

export const cardItem: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
    scale: 0.95,
  },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: duration.normal,
      ease: easing.easeOut,
    },
  },
};

export const cardItemFast: Variants = {
  hidden: {
    opacity: 0,
    y: 15,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

/**
 * List Animations
 * Use for staggered list items
 */
export const listContainer: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

export const listItem: Variants = {
  hidden: {
    opacity: 0,
    x: -10,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

/**
 * Tooltip Animation
 * Use for tooltips, popovers
 */
export const tooltip: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 5,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

/**
 * Character Entrance Animation
 * Use for character cards, portraits appearing
 */
export const characterEntrance: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.9,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: duration.slow,
      ease: easing.easeOut,
    },
  },
};
