import { describe, expect, it } from 'vitest';

import { parseSpellSlotLevel } from '../spell-slot-level';

describe('parseSpellSlotLevel', () => {
  it('accepts every supported spell-slot level', () => {
    for (let level = 0; level <= 9; level += 1) {
      expect(parseSpellSlotLevel(String(level))).toBe(level);
    }
  });

  it.each(['', '-1', '10', '1slot', '1.5', '1e1', '9007199254740992'])(
    'rejects the invalid spell-slot level %j',
    (level) => {
      expect(parseSpellSlotLevel(level)).toBeNull();
    },
  );
});
