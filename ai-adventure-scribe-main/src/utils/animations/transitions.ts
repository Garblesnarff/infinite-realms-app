import { duration, easing } from './constants';

import type { Variants } from 'framer-motion';

/**
 * Page Transitions
 * Use for route changes and major view transitions
 */
export const fadeInUp: Variants = {
  hidden: {
    opacity: 0,
    y: 20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
  exit: {
    opacity: 0,
    y: -20,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

export const fadeInDown: Variants = {
  hidden: {
    opacity: 0,
    y: -20,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
};

export const fadeIn: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

export const slideInLeft: Variants = {
  hidden: {
    opacity: 0,
    x: -30,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
};

export const slideInRight: Variants = {
  hidden: {
    opacity: 0,
    x: 30,
  },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
};

/**
 * Modal/Dialog Animations
 * Use for modal open/close
 */
export const modalBackdrop: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

export const modalContent: Variants = {
  hidden: {
    opacity: 0,
    scale: 0.95,
    y: 20,
  },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: duration.normal,
      ease: easing.easeOut,
    },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    y: 20,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

/**
 * Tab Switch Animation
 * Use for tab content changes
 */
export const tabContent: Variants = {
  enter: {
    opacity: 0,
    x: 10,
  },
  center: {
    opacity: 1,
    x: 0,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
  exit: {
    opacity: 0,
    x: -10,
    transition: {
      duration: duration.fast,
      ease: easing.ease,
    },
  },
};

/**
 * Collapse/Expand Animations
 * Use for accordions, collapsible sections
 */
export const collapse: Variants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      duration: duration.normal,
      ease: easing.ease,
    },
  },
};
