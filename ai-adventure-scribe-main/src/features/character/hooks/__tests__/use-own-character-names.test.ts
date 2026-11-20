import { describe, expect, it } from 'vitest';

import { findDuplicateHeroName } from '../use-own-character-names';

describe('findDuplicateHeroName', () => {
  it('matches case-insensitively with surrounding spaces', () => {
    const roster = [{ id: '1', name: '  Thorin Oakenshield  ' }];
    expect(findDuplicateHeroName('  thorin oakenshield ', roster)).toBe('thorin oakenshield');
  });

  it('returns null for a new name', () => {
    const roster = [{ id: '1', name: 'Thorin' }];
    expect(findDuplicateHeroName('Brand New Hero', roster)).toBeNull();
  });

  it('returns null for empty name', () => {
    const roster = [{ id: '1', name: 'Thorin' }];
    expect(findDuplicateHeroName('   ', roster)).toBeNull();
  });

  it('excludes the current character row', () => {
    const roster = [{ id: 'me', name: 'Thorin' }];
    expect(findDuplicateHeroName('Thorin', roster, 'me')).toBeNull();
  });

  it('returns null for undefined roster', () => {
    expect(findDuplicateHeroName('Thorin', undefined)).toBeNull();
  });
});
