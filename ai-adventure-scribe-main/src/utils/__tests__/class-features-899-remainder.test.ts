import { describe, expect, it } from 'vitest';

import { getClassFeatures } from '@/utils/classFeatures';

const names = (className: string, level: number): string[] =>
  getClassFeatures(className, level).map((f) => f.name);

describe('#899 remainder: Rogue Expertise on the sheet', () => {
  it('lists Expertise with its 2014 text at level 1', () => {
    expect(names('Rogue', 1)).toContain('expertise');
    const expertise = getClassFeatures('Rogue', 1).find((f) => f.name === 'expertise');
    expect(expertise?.description).toContain('proficiency bonus is doubled');
    expect(expertise?.level).toBe(1);
  });
});
