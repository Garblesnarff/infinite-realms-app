import { describe, expect, it } from 'vitest';

import { ownDeathSaveTally } from '../../../../shared/death-save-lines';

/**
 * #906 (strategist FIX): a result can hold two dying creatures' saves. The tray must take the
 * tally of the actor's own save, never a teammate's that the boundary appended after it.
 */
describe('ownDeathSaveTally (#906)', () => {
  const ACTOR = 'scholar-id';
  const TEAMMATE = 'ally-id';

  it('takes the actor’s last save, not a dying teammate’s that follows it in the result', () => {
    const tally = ownDeathSaveTally(
      [
        { participantId: ACTOR, roll: 13, successes: 3, failures: 0 },
        { participantId: TEAMMATE, roll: 4, successes: 0, failures: 2 },
      ],
      ACTOR,
    );
    expect(tally).toEqual({ successes: 3, failures: 0 });
  });

  it('takes the actor’s save even when the teammate’s save comes first', () => {
    const tally = ownDeathSaveTally(
      [
        { participantId: TEAMMATE, roll: 2, successes: 1, failures: 1 },
        { participantId: ACTOR, roll: 6, successes: 0, failures: 2 },
      ],
      ACTOR,
    );
    expect(tally).toEqual({ successes: 0, failures: 2 });
  });

  it('returns null when only a teammate rolled, so nothing is recorded for the actor', () => {
    expect(
      ownDeathSaveTally([{ participantId: TEAMMATE, roll: 9, successes: 1, failures: 0 }], ACTOR),
    ).toBeNull();
  });

  it('returns null for an empty result', () => {
    expect(ownDeathSaveTally([], ACTOR)).toBeNull();
  });

  it('reads a missing tally as zero, never as an invented count', () => {
    expect(ownDeathSaveTally([{ participantId: ACTOR, roll: 14 }], ACTOR)).toEqual({
      successes: 0,
      failures: 0,
    });
  });
});
