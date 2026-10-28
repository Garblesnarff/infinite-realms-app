import { describe, expect, it } from 'bun:test';

import { subclassFromClassFeatureChoices } from '../class-feature-choices';

const CLERIC = ['Life Domain', 'War Domain', 'Knowledge Domain'];

describe('subclassFromClassFeatureChoices (#899)', () => {
  it('reads the wizard domain pick from its choice string', () => {
    const features = {
      'divine-domain': {
        name: 'Divine Domain',
        choice: 'Life Domain: Focuses on healing and protection',
      },
    };
    expect(subclassFromClassFeatureChoices(features, CLERIC)).toBe('Life Domain');
  });

  it('returns null when no choice names one of the class subclasses', () => {
    const features = { 'divine-domain': { name: 'Divine Domain', choice: 'Something else' } };
    expect(subclassFromClassFeatureChoices(features, CLERIC)).toBeNull();
  });

  it('ignores entries without a string choice and missing input', () => {
    expect(subclassFromClassFeatureChoices(null, CLERIC)).toBeNull();
    expect(subclassFromClassFeatureChoices({ a: { name: 'x' } }, CLERIC)).toBeNull();
    expect(subclassFromClassFeatureChoices({ a: null }, CLERIC)).toBeNull();
  });
});
