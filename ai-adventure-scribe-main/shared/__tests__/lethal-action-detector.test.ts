import { describe, expect, it } from 'vitest';

import { isClearlyLethalAction } from '../lethal-action-detector';

describe('isClearlyLethalAction (#468)', () => {
  it('flags clearly lethal acts', () => {
    expect(isClearlyLethalAction('I step off the edge to my death')).toBe(true);
    expect(isClearlyLethalAction('I drink poison to kill myself')).toBe(true);
    expect(isClearlyLethalAction('I step into lava')).toBe(true);
    expect(isClearlyLethalAction('I jump off the cliff to my death')).toBe(true);
  });

  it('stays quiet on ordinary play', () => {
    expect(isClearlyLethalAction('I look over the edge')).toBe(false);
    expect(isClearlyLethalAction('I climb down carefully')).toBe(false);
    expect(isClearlyLethalAction('I jump the gap')).toBe(false);
    expect(isClearlyLethalAction('I attack the goblin')).toBe(false);
    expect(isClearlyLethalAction('')).toBe(false);
  });

  it('skips when a fight is live', () => {
    expect(isClearlyLethalAction('I step off the edge to my death', { inCombat: true })).toBe(
      false,
    );
  });
});
