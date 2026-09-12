import type { NarrationSegment } from '@/hooks/use-ai-response';
import type { AISegment } from '@/services/voice-routing';

/**
 * Helper function to convert NarrationSegments to AISegments
 */
export const convertNarrationToAISegments = (
  narrationSegments: NarrationSegment[],
): AISegment[] => {
  return narrationSegments.map((segment) => {
    const isNarration = ['dm', 'narration', 'transition'].includes(segment.type);
    return {
      type: (isNarration ? 'dm' : 'character') as 'dm' | 'character',
      text: segment.text,
      character: isNarration ? undefined : segment.character,
      voice_category: segment.voice_category,
    };
  });
};
