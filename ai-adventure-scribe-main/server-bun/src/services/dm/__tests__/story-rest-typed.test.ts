import { describe, expect, it } from 'bun:test';

import { typedRestType } from '../typed-rest.js';

describe('typedRestType (#751)', () => {
  it('reads a declared long rest', () => {
    expect(
      typedRestType('I take a full long rest - eight hours sleeping and tending my wounds...'),
    ).toBe('long');
    expect(typedRestType('We take a long rest.')).toBe('long');
    expect(typedRestType('I sleep for 8 hours by the fire')).toBe('long');
  });

  it('reads a declared short rest', () => {
    expect(typedRestType('I take a short rest.')).toBe('short');
    expect(typedRestType('We rest for an hour behind the rocks')).toBe('short');
  });

  it('ignores questions, negations and other text', () => {
    expect(typedRestType('Can we take a long rest?')).toBeNull();
    expect(typedRestType('should we short rest here?')).toBeNull();
    expect(typedRestType("I don't rest, I keep walking.")).toBeNull();
    expect(typedRestType('We keep walking.')).toBeNull();
    expect(typedRestType('')).toBeNull();
    expect(typedRestType('we took a long rest last week')).toBeNull();
    expect(typedRestType('I need a long rest')).toBeNull();
    expect(typedRestType("I can't sleep for 8 hours")).toBeNull();
    expect(typedRestType('I cannot sleep for 8 hours')).toBeNull();
    expect(typedRestType('I can take a long rest')).toBeNull();
    expect(typedRestType('I wish I could take a short rest')).toBeNull();
    expect(typedRestType('They take a long rest')).toBeNull();
  });
});
