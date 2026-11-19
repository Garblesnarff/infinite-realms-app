import { describe, expect, it } from 'vitest';

import { isDistinctSubtitle } from '../subtitle';

/** #1672: the tagline is a second line only when it differs from the title, ignoring case. */
describe('isDistinctSubtitle', () => {
  it('hides a tagline that repeats the title exactly', () => {
    expect(isDistinctSubtitle('Abyssal Descent', 'Abyssal Descent')).toBe(false);
  });

  it('hides a tagline that differs from the title only by case', () => {
    expect(isDistinctSubtitle('Abyssal Descent', 'ABYSSAL DESCENT')).toBe(false);
    expect(isDistinctSubtitle('Abyssal Descent', 'abyssal descent')).toBe(false);
  });

  it('ignores surrounding spaces', () => {
    expect(isDistinctSubtitle('Abyssal Descent', '  Abyssal Descent  ')).toBe(false);
  });

  it('shows a tagline that says something different', () => {
    expect(isDistinctSubtitle('Abyssal Descent', 'Fey courts and bad bargains.')).toBe(true);
  });

  it('shows nothing for a missing or blank tagline', () => {
    expect(isDistinctSubtitle('Abyssal Descent', null)).toBe(false);
    expect(isDistinctSubtitle('Abyssal Descent', undefined)).toBe(false);
    expect(isDistinctSubtitle('Abyssal Descent', '   ')).toBe(false);
  });
});
