import { describe, expect, it } from 'vitest';

import fixture from '../fixtures/roll-and-map.json';

describe('recorded DM response fixtures', () => {
  it('preserves a roll gate and map actions from the real structured shape', () => {
    expect(fixture.roll_requests).toHaveLength(1);
    expect(fixture.roll_requests[0].formula).toBe('1d20+4');
    expect(fixture.map_actions[0]).toMatchObject({ action: 'move', x: 4, y: 2 });
  });
});
