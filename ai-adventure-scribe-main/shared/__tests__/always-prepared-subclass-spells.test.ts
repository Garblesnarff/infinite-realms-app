import { describe, expect, it } from 'vitest';

import {
  ALWAYS_PREPARED_SUBCLASS_SPELLS,
  alwaysPreparedSpellNames,
} from '../always-prepared-subclass-spells';

describe('always-prepared subclass spells (2014 SRD)', () => {
  it('gives an Oath of Devotion paladin its oath spells at each paladin level', () => {
    expect(alwaysPreparedSpellNames('Oath of Devotion', 2)).toEqual([]);
    expect(alwaysPreparedSpellNames('Oath of Devotion', 3)).toEqual([
      'Protection from Evil and Good',
      'Sanctuary',
    ]);
    expect(alwaysPreparedSpellNames('Oath of Devotion', 5)).toEqual([
      'Protection from Evil and Good',
      'Sanctuary',
      'Lesser Restoration',
      'Zone of Truth',
    ]);
    expect(alwaysPreparedSpellNames('Oath of Devotion', 17)).toEqual([
      'Protection from Evil and Good',
      'Sanctuary',
      'Lesser Restoration',
      'Zone of Truth',
      'Beacon of Hope',
      'Dispel Magic',
      'Freedom of Movement',
      'Guardian of Faith',
      'Commune',
      'Flame Strike',
    ]);
  });

  it('keeps the Life Domain list that the sheet already reads', () => {
    expect(ALWAYS_PREPARED_SUBCLASS_SPELLS['Life Domain'][1]).toEqual(['Bless', 'Cure Wounds']);
    expect(alwaysPreparedSpellNames('Life Domain', 1)).toEqual(['Bless', 'Cure Wounds']);
    expect(alwaysPreparedSpellNames('Life Domain', 3)).toEqual([
      'Bless',
      'Cure Wounds',
      'Lesser Restoration',
      'Spiritual Weapon',
    ]);
  });
});
