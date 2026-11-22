import { describe, expect, it } from 'vitest';

import { isFinishedOneShotSession } from '../../shared/one-shot-completion';

describe('isFinishedOneShotSession (#1703)', () => {
  it('returns true only for a completed one-shot carrying a non-empty summary', () => {
    expect(
      isFinishedOneShotSession({
        status: 'completed',
        campaignLength: 'one-shot',
        summary: 'The bell fell silent — the adventure ends.',
      }),
    ).toBe(true);
  });

  it('returns false for a one-shot ended by hand (null, empty, or whitespace summary)', () => {
    expect(
      isFinishedOneShotSession({ status: 'completed', campaignLength: 'one-shot', summary: null }),
    ).toBe(false);
    expect(
      isFinishedOneShotSession({ status: 'completed', campaignLength: 'one-shot', summary: '' }),
    ).toBe(false);
    expect(
      isFinishedOneShotSession({ status: 'completed', campaignLength: 'one-shot', summary: '   ' }),
    ).toBe(false);
  });

  it('returns false for active sessions and non-one-shot campaigns', () => {
    expect(
      isFinishedOneShotSession({ status: 'active', campaignLength: 'one-shot', summary: 'Done.' }),
    ).toBe(false);
    expect(
      isFinishedOneShotSession({ status: 'completed', campaignLength: 'full', summary: 'Done.' }),
    ).toBe(false);
    expect(
      isFinishedOneShotSession({ status: 'completed', campaignLength: null, summary: 'Done.' }),
    ).toBe(false);
  });
});
