import { describe, expect, it } from 'vitest';

import { deduplicateNarrativeParagraphs } from '../deduplicate-narrative-paragraphs';

const FIRST =
  'The torchlight gutters as the goblin captain lunges across the broken bridge, and the rope groans under the weight of the whole party.';

describe('deduplicateNarrativeParagraphs (#750)', () => {
  it('drops a later paragraph that is an earlier one cut short', () => {
    const cutShort =
      'The torchlight gutters as the goblin captain lunges across the broken bridge, and the rope groans.';

    expect(deduplicateNarrativeParagraphs([FIRST, cutShort])).toEqual([FIRST]);
  });

  it('keeps a paragraph that only matches an earlier one mid-word', () => {
    expect(deduplicateNarrativeParagraphs([FIRST, 'The torch'])).toEqual([FIRST, 'The torch']);
  });

  it('keeps a longer continuation that starts with the same opening', () => {
    const continuation =
      'The torchlight gutters as the goblin captain lunges across the broken bridge. Then the goblin falls silent, staring past you toward the dark tunnel where something heavy is dragging itself closer over the stones.';

    expect(deduplicateNarrativeParagraphs([FIRST, continuation])).toEqual([FIRST, continuation]);
  });
});
