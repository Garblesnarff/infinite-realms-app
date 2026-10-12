import { describe, expect, it } from 'vitest';

import { conversationHistoryFrom } from '../conversation-history';

import type { ChatMessage } from '@/types/game';

describe('conversationHistoryFrom narration segments (#458)', () => {
  it('passes dm/character/transition segments through untouched', () => {
    const segments: ChatMessage['narrationSegments'] = [
      { type: 'dm', text: 'The hall is silent.', voice_category: 'narrator' },
      {
        type: 'character',
        text: 'Who goes there?',
        character: 'Guard',
        voice_category: 'guard',
      },
      { type: 'transition', text: 'Combat begins.' },
    ];
    const history = conversationHistoryFrom([
      { id: 'd1', sender: 'dm', text: 'The hall is silent.', narrationSegments: segments },
    ]);

    expect(history[0].narrationSegments).toEqual(segments);
  });

  it('maps legacy game segment kinds onto the service vocabulary', () => {
    const history = conversationHistoryFrom([
      {
        id: 'd1',
        sender: 'dm',
        text: 'Mixed legacy kinds.',
        narrationSegments: [
          { type: 'narration', text: 'Prose.' },
          { type: 'dialogue', text: 'Speech.', character: 'Guard' },
          { type: 'action', text: 'She draws her sword.' },
          { type: 'thought', text: 'He wonders why.' },
        ],
      },
    ]);

    expect(history[0].narrationSegments).toEqual([
      { type: 'dm', text: 'Prose.' },
      { type: 'character', text: 'Speech.', character: 'Guard' },
      { type: 'dm', text: 'She draws her sword.' },
      { type: 'dm', text: 'He wonders why.' },
    ]);
  });

  it('leaves messages without segments without them', () => {
    const history = conversationHistoryFrom([
      { id: 'p1', sender: 'player', text: 'I listen at the door.' },
    ]);

    expect(history[0].narrationSegments).toBeUndefined();
  });
});
