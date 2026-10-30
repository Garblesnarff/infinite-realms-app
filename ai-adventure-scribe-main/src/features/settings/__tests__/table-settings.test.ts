import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_SETTINGS,
  readTableSettings,
  tableSettingsKey,
  writeTableSettings,
} from '../table-settings';

describe('table settings store (#1236 section F)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the defaults when nothing is saved', () => {
    expect(readTableSettings('user-a')).toEqual(DEFAULT_TABLE_SETTINGS);
  });

  it('round-trips a saved value for the same user', () => {
    writeTableSettings('user-a', {
      ...DEFAULT_TABLE_SETTINGS,
      diceSound: false,
      reduceMotion: 'on',
    });
    expect(readTableSettings('user-a')).toMatchObject({ diceSound: false, reduceMotion: 'on' });
  });

  it('keeps two users on one browser apart', () => {
    writeTableSettings('user-a', { ...DEFAULT_TABLE_SETTINGS, showNPCRolls: false });
    expect(readTableSettings('user-b')).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(tableSettingsKey('user-a')).not.toEqual(tableSettingsKey('user-b'));
  });

  it('falls back to defaults for unreadable or wrong-typed values', () => {
    window.localStorage.setItem(tableSettingsKey('user-a'), '{not json');
    expect(readTableSettings('user-a')).toEqual(DEFAULT_TABLE_SETTINGS);

    window.localStorage.setItem(
      tableSettingsKey('user-a'),
      JSON.stringify({ diceSound: 'yes', reduceMotion: 'sometimes', showNPCRolls: false }),
    );
    expect(readTableSettings('user-a')).toEqual({
      ...DEFAULT_TABLE_SETTINGS,
      showNPCRolls: false,
    });
  });
});
