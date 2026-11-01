import { describe, expect, it } from 'vitest';

import { deduplicateNarrativeParagraphs } from '../deduplicate-narrative-paragraphs';

const FIRST =
  'The torchlight gutters as the goblin captain lunges across the broken bridge, and the rope groans under the weight of the whole party.';

describe('deduplicateNarrativeParagraphs (#750)', () => {
  it('drops a later paragraph that is an earlier one cut short', () => {
    // A true word-boundary prefix of FIRST, cut mid-sentence. Shorter than Check 2's
    // 80-character window, so only Check 1 (the prefix rule) can drop it.
    const cutAt = FIRST.indexOf(' lunges') + ' lunges'.length;
    const cutShort = FIRST.slice(0, cutAt);

    expect(FIRST[cutAt]).toBe(' ');
    expect(cutShort.length).toBeLessThan(80);
    expect(deduplicateNarrativeParagraphs([FIRST, cutShort])).toEqual([FIRST]);
  });

  it('drops a verbatim repeat of an earlier paragraph', () => {
    expect(deduplicateNarrativeParagraphs([FIRST, FIRST])).toEqual([FIRST]);
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
