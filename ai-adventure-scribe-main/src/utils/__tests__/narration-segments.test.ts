import { describe, expect, it } from 'vitest';

import {
  narrationSegmentsFromPersistedContext,
  persistableNarrationSegments,
  resolveNarrationSegments,
} from '../narration-segments';

const segments = [
  {
    type: 'dm' as const,
    text: 'The captain steps forward.',
    character: undefined,
    voice_category: 'narrator',
  },
  {
    type: 'character' as const,
    text: 'Hold the line.',
    character: 'Captain Sarah Reeves',
    voice_category: 'guard',
  },
];

describe('narration segment persistence helpers', () => {
  it('persists message narrationSegments onto the session context payload', () => {
    expect(persistableNarrationSegments({ narrationSegments: segments })).toEqual(segments);
  });

  it('restores segments from persisted context and prefers explicit play-button segments', () => {
    expect(narrationSegmentsFromPersistedContext({ narration_segments: segments })).toEqual(
      segments,
    );
    expect(resolveNarrationSegments({ context: { narration_segments: segments } })).toEqual(
      segments,
    );
    expect(
      resolveNarrationSegments({ context: { narration_segments: segments } }, [
        { type: 'dm', text: 'override', voice_category: 'narrator' },
      ]),
    ).toEqual([{ type: 'dm', text: 'override', voice_category: 'narrator' }]);
    expect(resolveNarrationSegments({ narrationSegments: [] })).toBeUndefined();
  });
});
