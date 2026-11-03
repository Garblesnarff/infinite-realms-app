import { describe, expect, it } from 'vitest';

import { effectiveReduceMotion } from '../reduce-motion';

describe('effectiveReduceMotion', () => {
  it('follows the system unless the player overrides it', () => {
    expect(effectiveReduceMotion('system', true)).toBe(true);
    expect(effectiveReduceMotion('system', false)).toBe(false);
    expect(effectiveReduceMotion('on', false)).toBe(true);
    expect(effectiveReduceMotion('off', true)).toBe(false);
  });
});
