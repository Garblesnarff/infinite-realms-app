import { describe, expect, it } from 'vitest';

import { getCampaignSessionNumbers } from './session-numbering';

describe('getCampaignSessionNumbers', () => {
  it('numbers sessions chronologically within the campaign', () => {
    const numbers = getCampaignSessionNumbers([
      { id: 'newest', created_at: '2026-08-13T12:00:00.000Z' },
      { id: 'oldest', created_at: '2026-08-11T12:00:00.000Z' },
      { id: 'middle', created_at: '2026-08-12T12:00:00.000Z' },
    ]);

    expect(numbers).toEqual(
      new Map([
        ['oldest', 1],
        ['middle', 2],
        ['newest', 3],
      ]),
    );
  });

  it('keeps the numbering independent from API response order', () => {
    const numbers = getCampaignSessionNumbers([
      { id: 'later', created_at: '2026-08-12T12:00:00.000Z' },
      { id: 'earlier', created_at: '2026-08-11T12:00:00.000Z' },
    ]);

    expect(numbers.get('earlier')).toBe(1);
    expect(numbers.get('later')).toBe(2);
  });
});
