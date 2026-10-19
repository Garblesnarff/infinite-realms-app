import type { CastingSegment } from '../npc-voices';

/** narration_segments wire shape, passed unchanged by VoiceDirector.castAISegments. */
export const npcVoiceCastSegments: CastingSegment[] = [
  { type: 'dm', text: 'Two merchants speak in the square.' },
  { type: 'character', text: 'Welcome.', character: 'Mara', voice_category: 'merchant' },
  { type: 'character', text: 'Over here.', character: 'Tovin', voice_category: 'merchant' },
  { type: 'character', text: 'Who are you?', character: 'Unknown NPC' },
  {
    type: 'character',
    text: 'I am the player.',
    character: 'Player Hero',
    voice_category: 'hero_male',
  },
];
