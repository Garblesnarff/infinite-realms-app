import { describe, expect, it } from 'vitest';

import { findDeclaredSkill } from '@/utils/roll-request/declared-roll';

describe('findDeclaredSkill', () => {
  it('picks the skill mentioned earliest, not the longest', () => {
    expect(
      findDeclaredSkill({
        purpose: 'Insight check: does Tavo catch the lie, or is his perception fooled?',
      }),
    ).toBe('insight');
  });

  it('picks the first skill mentioned when the later one is also a skill', () => {
    expect(
      findDeclaredSkill({
        purpose: 'Perception check to spot the archer; Insight will not help here',
      }),
    ).toBe('perception');
  });

  it('finds a skill wrapped in an ability name', () => {
    expect(findDeclaredSkill({ purpose: 'Wisdom (Insight) check' })).toBe('insight');
  });

  it('prefers the longer term at the same start index', () => {
    expect(findDeclaredSkill({ purpose: 'Sleight of Hand check' })).toBe('sleight of hand');
  });

  it('finds a plain skill mention', () => {
    expect(findDeclaredSkill({ purpose: 'Make a Stealth check' })).toBe('stealth');
  });

  it('returns undefined when no skill is mentioned', () => {
    expect(findDeclaredSkill({ purpose: 'a strong push' })).toBeUndefined();
  });
});
