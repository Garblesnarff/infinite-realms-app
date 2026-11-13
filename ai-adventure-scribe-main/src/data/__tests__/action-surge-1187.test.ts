import { describe, expect, it } from 'vitest';

import { collapseActionSurgeRows } from '../../../shared/action-surge-rows';

import { getAllClassFeaturesUpToLevel, getClassFeaturesForLevel } from '@/data/levelProgression';

describe('#1187 one Action Surge feature', () => {
  it('a level-17 fighter lists one Action Surge, gained at level 2', () => {
    const features = getAllClassFeaturesUpToLevel('fighter', 17);
    const surges = features.filter(
      (feature) =>
        feature.featureName
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim()
          .toLowerCase() === 'action surge',
    );
    expect(surges).toEqual([
      expect.objectContaining({
        level: 2,
        featureName: 'Action Surge (1 use)',
      }),
    ]);
    expect(surges[0].description).toContain('twice before a rest');
  });

  it('level 17 does not grant a second Action Surge feature', () => {
    const gained = getClassFeaturesForLevel('fighter', 17).map((feature) => feature.featureName);
    expect(gained).toContain('Indomitable (3 uses)');
    expect(gained.some((name) => name.toLowerCase().includes('action surge'))).toBe(false);
  });

  it('the read keeps the level-2 row when a level-17 row is also present', () => {
    const rows = collapseActionSurgeRows([
      { featureName: 'Action Surge (2 uses)', level: 17 },
      { featureName: 'Second Wind', level: 1 },
      { featureName: 'Action Surge (1 use)', level: 2 },
    ]);
    expect(rows.map((row) => row.featureName)).toEqual(['Second Wind', 'Action Surge (1 use)']);
  });
});
