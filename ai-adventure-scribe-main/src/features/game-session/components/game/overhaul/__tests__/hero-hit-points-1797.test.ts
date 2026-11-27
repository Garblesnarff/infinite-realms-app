/**
 * #1797: the table panel and the header show the hero's HP from the same source. In Hark's fight
 * the panel read 19/28 while the header and summary read 14/28.
 */
import { describe, expect, it } from 'vitest';

import { heroHitPoints } from '../useOverhaulViewModel';

const sheet = { hpCurrent: 19, hpMax: 28 };

describe('heroHitPoints (#1797)', () => {
  it('shows the server combat status when there is one, as the header does', () => {
    const combat = { current_hp: 14, max_hp: 28, temp_hp: 0, is_conscious: true };
    expect(heroHitPoints(combat, sheet)).toEqual({ currentHp: 14, maxHp: 28 });
  });

  it('falls back to the sheet outside combat', () => {
    expect(heroHitPoints(null, sheet)).toEqual({ currentHp: 19, maxHp: 28 });
  });

  it('gives the header and the panel the same number for the same status', () => {
    const combat = { current_hp: 0, max_hp: 28, temp_hp: 0, is_conscious: false };
    expect(heroHitPoints(combat, sheet).currentHp).toBe(0);
  });
});
