import { describe, expect, it } from 'vitest';

import { isClearlyLethalAction } from '../lethal-action-detector';

describe('isClearlyLethalAction (#468)', () => {
  it('flags clearly lethal acts', () => {
    expect(isClearlyLethalAction('I step off the edge to my death')).toBe(true);
    expect(isClearlyLethalAction('I drink poison to kill myself')).toBe(true);
    expect(isClearlyLethalAction('I step into lava')).toBe(true);
    expect(isClearlyLethalAction('I jump off the cliff to my death')).toBe(true);
    expect(isClearlyLethalAction('I step off the cliff')).toBe(true);
    expect(isClearlyLethalAction('I jump off the cliff')).toBe(true);
    expect(isClearlyLethalAction('I leap off the tower')).toBe(true);
    expect(isClearlyLethalAction('I throw myself off the bridge')).toBe(true);
    expect(isClearlyLethalAction('I jump off the roof.')).toBe(true);
    expect(isClearlyLethalAction('Fine. I step off the ledge.')).toBe(true);
    expect(isClearlyLethalAction('I jump off the edge of the cliff')).toBe(true);
    expect(isClearlyLethalAction('I dive into the lava')).toBe(true);
  });

  it('stays quiet on ordinary play', () => {
    expect(isClearlyLethalAction('I look over the edge')).toBe(false);
    expect(isClearlyLethalAction('I climb down carefully')).toBe(false);
    expect(isClearlyLethalAction('I jump the gap')).toBe(false);
    expect(isClearlyLethalAction('I attack the goblin')).toBe(false);
    expect(isClearlyLethalAction('')).toBe(false);
  });

  it('stays quiet on the rescue and search lines that only sound lethal', () => {
    expect(isClearlyLethalAction('I jump off the cliff to rescue the child')).toBe(false);
    expect(isClearlyLethalAction('I jump off the bridge into the lake')).toBe(false);
    expect(isClearlyLethalAction('I leap off the cliff onto the ledge')).toBe(false);
    expect(isClearlyLethalAction('I jump off the edge of the cliff onto the ledge')).toBe(false);
    expect(isClearlyLethalAction('I walk into the lava cave to look for the gem')).toBe(false);
    expect(isClearlyLethalAction('I drink the poison antidote')).toBe(false);
  });

  it('skips when a fight is live', () => {
    expect(isClearlyLethalAction('I step off the edge to my death', { inCombat: true })).toBe(
      false,
    );
  });
});
