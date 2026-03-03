import { cardContainer, cardItem, listContainer, listItem } from './component-variants';
import { hoverLift, hoverScale, hoverGlow } from './feedback-variants';
import { modalBackdrop, modalContent } from './transitions';

/**
 * Preset Combinations
 * Common animation patterns ready to use
 */
export const presets = {
  // Page load: staggered card grid
  cardGrid: {
    container: cardContainer,
    item: cardItem,
  },
  // Modal open/close
  modal: {
    backdrop: modalBackdrop,
    content: modalContent,
  },
  // List with stagger
  list: {
    container: listContainer,
    item: listItem,
  },
  // Hover interactions
  hover: {
    lift: hoverLift,
    scale: hoverScale,
    glow: hoverGlow,
  },
};

export default presets;
