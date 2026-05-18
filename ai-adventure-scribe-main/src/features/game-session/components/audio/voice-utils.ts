import type { NarrationSegment } from '@/hooks/use-ai-response';
import type { AISegment } from '@/services/voice-routing';

/**
 * Helper function to convert NarrationSegments to AISegments
 */
export const convertNarrationToAISegments = (narrationSegments: NarrationSegment[]): AISegment[] => {
  return narrationSegments.map((segment) => ({
    type: (['dm', 'narration'].includes(segment.type) ? 'dm' : 'character') as 'dm' | 'character',
    text: segment.text,
    character: segment.character,
    voice_category: segment.voice_category,
  }));
};
