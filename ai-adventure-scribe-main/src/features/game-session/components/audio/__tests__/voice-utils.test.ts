import { describe, expect, it } from 'vitest';

import { convertNarrationToAISegments } from '../voice-utils';

import type { NarrationSegment } from '@/hooks/use-ai-response';

describe('convertNarrationToAISegments', () => {
  it('routes narration and transition segments to the narrator voice path', () => {
    const segments: NarrationSegment[] = [
      { type: 'dm', text: 'The door opens.', character: 'DM', voice_category: 'narrator' },
      {
        type: 'transition',
        text: 'Later that night.',
        character: 'DM',
        voice_category: 'narrative',
      },
      {
        type: 'character',
        text: 'Halt.',
        character: 'Sergeant Vance',
        voice_category: 'gruff',
      },
    ];
    const result = convertNarrationToAISegments(segments);

    expect(result).toEqual([
      { type: 'dm', text: 'The door opens.', character: undefined, voice_category: 'narrator' },
      {
        type: 'dm',
        text: 'Later that night.',
        character: undefined,
        voice_category: 'narrative',
      },
      {
        type: 'character',
        text: 'Halt.',
        character: 'Sergeant Vance',
        voice_category: 'gruff',
      },
    ]);
  });
});
