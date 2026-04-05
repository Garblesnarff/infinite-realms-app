import { atmospherePatterns } from './atmosphere';
import { characterMomentPatterns } from './character-moment';
import { dialogueGemPatterns } from './dialogue-gem';
import { eventPatterns } from './event';
import { foreshadowingPatterns } from './foreshadowing';
import { itemPatterns } from './item';
import { locationPatterns } from './location';
import { npcPatterns } from './npc';
import { plotPointPatterns } from './plot-point';
import { questPatterns } from './quest';
import { storyBeatPatterns } from './story-beat';
import { worldDetailPatterns } from './world-detail';

import type { ClassificationPattern } from './types';
import type { MemoryType } from '@/types/memory';

export * from './types';
export * from './location';
export * from './npc';
export * from './event';
export * from './item';
export * from './quest';
export * from './story-beat';
export * from './character-moment';
export * from './dialogue-gem';
export * from './plot-point';
export * from './foreshadowing';
export * from './world-detail';
export * from './atmosphere';

export const CLASSIFICATION_PATTERNS: Record<MemoryType, ClassificationPattern> = {
  general: {
    type: 'general',
    patterns: [],
    contextPatterns: [],
    importance: 3,
  },
  npc: npcPatterns,
  location: locationPatterns,
  quest: questPatterns,
  item: itemPatterns,
  event: eventPatterns,
  story_beat: storyBeatPatterns,
  character_moment: characterMomentPatterns,
  world_detail: worldDetailPatterns,
  dialogue_gem: dialogueGemPatterns,
  atmosphere: atmospherePatterns,
  plot_point: plotPointPatterns,
  foreshadowing: foreshadowingPatterns,
};
