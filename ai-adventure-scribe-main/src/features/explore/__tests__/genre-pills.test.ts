import { describe, expect, it } from 'vitest';

import { genrePillsFor } from '../PublicExploreCard';

/** #1664 item 9: the genre tags stay on one row; the rest are counted. */
describe('genrePillsFor', () => {
  it('shows two genres and counts the rest', () => {
    expect(genrePillsFor(['Horror', 'Dungeon', 'Mystery'])).toEqual({
      shown: ['Horror', 'Dungeon'],
      hidden: 1,
    });
  });

  it('shows every genre with no count when there are two or fewer', () => {
    expect(genrePillsFor(['Fantasy'])).toEqual({ shown: ['Fantasy'], hidden: 0 });
    expect(genrePillsFor(['Comedy', 'Fantasy'])).toEqual({
      shown: ['Comedy', 'Fantasy'],
      hidden: 0,
    });
  });

  it('shows nothing for a campaign with no genres', () => {
    expect(genrePillsFor([])).toEqual({ shown: [], hidden: 0 });
  });
});
