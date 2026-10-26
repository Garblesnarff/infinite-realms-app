import { describe, expect, it } from 'vitest';

import { findDeclaredSkill, narratedSkillCheck } from '@/utils/roll-request/declared-roll';

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

describe('narratedSkillCheck (#1086 (c))', () => {
  it('returns the single skill the narration asks for', () => {
    expect(narratedSkillCheck('Make an Insight check to judge whether he is lying.')).toBe(
      'insight',
    );
  });

  it('returns undefined when the narration asks for no skill check', () => {
    expect(narratedSkillCheck('You crouch low, scanning the room.')).toBeUndefined();
  });

  it('returns undefined when the narration asks for two different skills', () => {
    expect(
      narratedSkillCheck('Make an Insight check. Then roll a Perception check.'),
    ).toBeUndefined();
  });

  it('matches "roll for an <skill> check" with article and check word', () => {
    expect(narratedSkillCheck('Please roll for an Insight check.')).toBe('insight');
    expect(narratedSkillCheck('Now roll for a Perception check.')).toBe('perception');
  });

  it('matches the simple "roll <skill>" form', () => {
    expect(narratedSkillCheck('Roll Insight to see if he lies.')).toBe('insight');
  });

  it('matches a multi-word skill at the unit level', () => {
    expect(narratedSkillCheck('Make a sleight of hand check.')).toBe('sleight of hand');
  });

  it('canonicalises alias forms the codebase already knows', () => {
    expect(narratedSkillCheck('Make a sleight check.')).toBe('sleight of hand');
    expect(narratedSkillCheck('Make an animal check.')).toBe('animal handling');
  });
});
